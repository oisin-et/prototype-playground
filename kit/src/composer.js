// The canvas's composer (src/canvas.js): one floating bar at the bottom that
// asks Claude for an iteration of the selected frame. Part of the
// prototype-playground kit.
//
// It talks to serve.py's chat (POST /playground/chat, a stream of JSON lines,
// as the classic Claude panel does) and keeps up to four chats as tabs, each
// with its own conversation, which carries on between messages. The
// conversation shows in a sheet above the bar while a chat runs, and on a
// click on the chevron. Screenshots: hold ⌥ and drag over any live frame; the
// picture waits above the box until Send.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/**
 * hooks: {
 *   key,                          // localStorage prefix
 *   context(): {label, body} | null,  // the selected frame: its name, and what the server is told
 *   toast(text),
 *   done({ new: [{playground, version}], updated: [...] }),  // a run finished
 *   notes(): the canvas's notes (src/notes.js): count(), take(), answered(list), restore(ids)
 * }
 */
export function mountComposer(root, hooks) {
  const KEY = `${hooks.key}.chats`;
  const saved = store.get(KEY, null);
  const chats = saved?.chats?.length ? saved.chats : [{ id: 'c1', session: null, log: [] }];
  let active = chats.find((c) => c.id === saved?.active) ? saved.active : chats[0].id;
  let enabled = false, maxTabs = 4, open = false;
  const running = new Map(); // chat id → { started, status }
  const pending = []; // screenshots waiting: { png, note, url }

  root.innerHTML = `
    <div class="cm-sheet" hidden>
      <div class="cm-log" aria-live="polite"></div>
      <div class="cm-run" hidden><span class="cm-status"></span><button type="button" class="cm-stop">Stop</button></div>
    </div>
    <ol class="cm-notes" hidden></ol>
    <div class="cm-shots" hidden></div>
    <form class="cm-bar">
      <div class="cm-tabs" role="tablist" aria-label="Chats"></div>
      <span class="cm-target"></span>
      <textarea rows="1" placeholder="Ask Claude for an iteration…" aria-label="Message to Claude"></textarea>
      <button type="button" class="cm-toggle" aria-label="Show the conversation" title="The conversation">⌃</button>
      <button type="submit" class="cm-send">Send</button>
    </form>`;
  const sheet = root.querySelector('.cm-sheet');
  const logEl = root.querySelector('.cm-log');
  const runEl = root.querySelector('.cm-run');
  const statusEl = root.querySelector('.cm-status');
  const shotsEl = root.querySelector('.cm-shots');
  const form = root.querySelector('form');
  const tabsEl = root.querySelector('.cm-tabs');
  const targetEl = root.querySelector('.cm-target');
  const input = root.querySelector('textarea');
  const toggle = root.querySelector('.cm-toggle');

  const chat = () => chats.find((c) => c.id === active);
  const keep = () => store.set(KEY, { active, chats: chats.map((c) => ({ ...c, log: c.log.slice(-80) })) });

  function drawTabs() {
    tabsEl.innerHTML = chats.map((c, i) => `<button type="button" role="tab" data-id="${c.id}" aria-selected="${c.id === active}" class="${running.has(c.id) ? 'busy' : ''}" title="${esc(c.log.find((m) => m.who === 'you')?.text?.slice(0, 80) || `Chat ${i + 1}`)}">${i + 1}</button>`).join('')
      + (chats.length < maxTabs ? '<button type="button" class="cm-add" aria-label="New chat" title="New chat">+</button>' : '');
  }
  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.classList.contains('cm-add')) {
      const n = chats.length + 1;
      chats.push({ id: `c${Date.now().toString(36)}`, session: null, log: [] });
      active = chats.at(-1).id;
      setOpen(false);
      hooks.toast(`Chat ${n}: a new conversation.`);
    } else active = b.dataset.id;
    keep();
    drawTabs();
    drawLog();
    input.focus();
  });
  // A tab's ✕ is a long story: a double-click on a tab with no run clears it.
  tabsEl.addEventListener('dblclick', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b || running.has(b.dataset.id) || chats.length < 2) return;
    chats.splice(chats.findIndex((c) => c.id === b.dataset.id), 1);
    active = chats[0].id;
    keep();
    drawTabs();
    drawLog();
  });

  function setOpen(v) {
    open = v;
    sheet.hidden = !open || !chat().log.length;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? '⌄' : '⌃';
    if (open) logEl.scrollTop = logEl.scrollHeight;
  }
  toggle.addEventListener('click', () => setOpen(!open));

  function drawLog() {
    const c = chat();
    logEl.innerHTML = c.log.map((m) => `<div class="cm-m ${m.who}">${m.who === 'you' ? '<b>You</b> ' : ''}${esc(m.text)}${m.view ? ` <button type="button" class="cm-view" data-view="${esc(m.view)}">View</button>` : ''}</div>`).join('');
    sheet.hidden = !open || !c.log.length;
    const r = running.get(active);
    runEl.hidden = !r;
    if (r) statusEl.textContent = `${r.status} ${clock(r.started)}`;
    logEl.scrollTop = logEl.scrollHeight;
    form.querySelector('.cm-send').disabled = !enabled || !!r;
  }
  logEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (b) hooks.view?.(b.dataset.view);
  });
  const clock = (t) => { const s = Math.round((Date.now() - t) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  setInterval(() => { if (running.size) drawLog(); }, 1000);

  const say = (c, who, text, view) => {
    c.log.push({ who, text, view });
    keep();
    if (c.id === active) drawLog();
  };

  function drawTarget() {
    const ctx = hooks.context();
    targetEl.innerHTML = ctx ? `▣ ${ctx.label}` : 'Select a frame';
    input.placeholder = !enabled ? (chatWhy || 'Chat is off') : ctx ? 'Ask Claude for an iteration of this frame…' : 'Select a frame first, or ask for a new exploration…';
  }

  function drawShots() {
    shotsEl.hidden = !pending.length;
    shotsEl.innerHTML = pending.map((s, i) => `<span class="cm-shot"><img src="${s.url}" alt=""><button type="button" data-drop="${i}" aria-label="Remove the screenshot">×</button></span>`).join('');
  }
  shotsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-drop]');
    if (b) { pending.splice(+b.dataset.drop, 1); drawShots(); }
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
    e.stopPropagation(); // the canvas's keys (F, arrows, Space) aren't for the box
  });
  input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    const notes = hooks.notes?.();
    if (!enabled || (!message && !pending.length && !notes?.count()) || running.has(active)) return;
    input.value = '';
    input.style.height = '';
    const shots = pending.splice(0);
    drawShots();
    const batch = notes?.take() || [];
    notes?.set(false);
    send(chat(), message || (batch.length ? `Work through ${batch.length === 1 ? 'this note' : `these ${batch.length} notes`}.` : 'See the screenshot.'), shots, batch);
  });

  async function send(c, message, shots, batch = []) {
    const ctx = hooks.context();
    const extra = [shots.length && `${shots.length} screenshot${shots.length > 1 ? 's' : ''}`, batch.length && `${batch.length} note${batch.length > 1 ? 's' : ''}`].filter(Boolean);
    say(c, 'you', message + (extra.length ? ` (${extra.join(', ')})` : ''));
    let answered = false;
    running.set(c.id, { started: Date.now(), status: 'Claude is working…' });
    setOpen(true);
    drawTabs();
    drawLog();
    let result = null;
    try {
      const r = await fetch('/playground/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Playground': 'chat' },
        body: JSON.stringify({
          message, tab: c.id, session: c.session,
          attachments: shots.map((s) => ({ type: 'image/png', data: s.png, note: s.note })),
          notes: batch,
          ...(ctx?.body || {}),
        }),
      });
      if (!r.ok) {
        const why = await r.json().catch(() => null);
        say(c, 'error', why?.error || `The server said no (${r.status}).`);
        return;
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'session') c.session = ev.id;
          else if (ev.type === 'text') say(c, 'claude', ev.text);
          else if (ev.type === 'tool') { if (/^(Editing|Writing|Running)/.test(ev.label)) say(c, 'step', ev.label); else running.get(c.id).status = `${ev.label}…`; }
          else if (ev.type === 'refused') say(c, 'error', `Not allowed: ${ev.label}`);
          else if (ev.type === 'error') say(c, 'error', ev.message);
          else if (ev.type === 'notes') {
            answered = true;
            const said = hooks.notes?.().answered(ev.notes);
            say(c, said ? 'done' : 'error', said ? `Notes: ${said}` : "Claude didn't answer the notes. Their pins say Sent: open one and press Send again.");
          } else if (ev.type === 'done') { if (ev.session) c.session = ev.session; result = ev; }
        }
      }
    } catch {
      say(c, 'error', 'Lost the connection to serve.py.');
    } finally {
      if (batch.length && !answered && !result) {
        hooks.notes?.().restore(batch.map((x) => x.id));
        say(c, 'error', "The notes didn't reach Claude, so they wait above the box again.");
      }
      running.delete(c.id);
      keep();
      drawTabs();
      drawLog();
    }
    if (result) {
      const made = [...(result.new || []), ...(result.updated || [])];
      const names = made.map((x) => `${x.playground} ${x.version.slice(1)}`);
      say(c, 'done', made.length
        ? `${result.new?.length ? 'Made' : 'Updated'} ${names.join(', ')}${result.cost ? ` · $${result.cost.toFixed(2)}` : ''}`
        : `Finished, with no new version${result.cost ? ` · $${result.cost.toFixed(2)}` : ''}.`, made[0] ? `${made[0].playground}/${made[0].version}` : undefined);
      hooks.done(result);
    }
  }
  runEl.querySelector('.cm-stop').addEventListener('click', () => {
    fetch('/playground/chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'chat' }, body: JSON.stringify({ tab: active }) });
  });

  let chatWhy = '';
  fetch('/playground/chat', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
    enabled = !!s?.enabled;
    maxTabs = Math.min(4, s?.tabs || 4);
    chatWhy = s?.why === 'off' ? 'Chat is off: start serve.py without --no-chat' : s?.why === 'missing' ? "Claude Code isn't installed on this computer" : '';
    input.disabled = !enabled;
    drawTabs();
    drawTarget();
    drawLog();
  }).catch(() => {});

  drawTabs();
  drawLog();
  drawTarget();
  return {
    drawTarget,
    notesEl: root.querySelector('.cm-notes'),
    addShot(png, note) {
      pending.push({ png, note, url: `data:image/png;base64,${png}` });
      drawShots();
      input.focus();
    },
  };
}
