// The canvas's chat (src/canvas.js): the panel at the left, joined to the
// header, that asks Claude for an iteration of the selected frame. Part of
// the prototype-playground kit.
//
// It talks to serve.py's chat (POST /playground/chat, a stream of JSON lines,
// as the classic Claude panel does) and keeps up to four chats as tabs, each
// with its own conversation, which carries on between messages. Each message
// carries a chip with the frame it was about; the box's chip names the
// selected frame. Screenshots (⌥-drag over a live frame), pasted pictures and
// notes wait in the box until Send.

import { ICON } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/**
 * hooks: {
 *   key,                          // localStorage prefix
 *   context(): {chip, kind, body} | null,  // the selected frame: its name, main or exp, and what the server is told
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
  let enabled = false, maxTabs = 4;
  const running = new Map(); // chat id → { started, status }
  const pending = []; // screenshots waiting: { png, note, url }

  root.innerHTML = `
    <div class="cm-tabs" role="tablist" aria-label="Chats"></div>
    <div class="cm-log" aria-live="polite"></div>
    <div class="cm-run" hidden><span class="cm-status"></span><button type="button" class="cm-stop" aria-label="Stop" title="Stop">${ICON.stop}</button></div>
    <form class="cm-box">
      <span class="cm-target"></span>
      <ol class="cm-notes" hidden></ol>
      <div class="cm-shots" hidden></div>
      <textarea rows="1" placeholder="Chat" aria-label="Message to Claude"></textarea>
      <button type="submit" class="cm-send" aria-label="Send" title="Send (Enter)">${ICON.send}</button>
    </form>`;
  const logEl = root.querySelector('.cm-log');
  const runEl = root.querySelector('.cm-run');
  const statusEl = root.querySelector('.cm-status');
  const shotsEl = root.querySelector('.cm-shots');
  const form = root.querySelector('form');
  const tabsEl = root.querySelector('.cm-tabs');
  const targetEl = root.querySelector('.cm-target');
  const input = root.querySelector('textarea');
  const chipOf = (frame, kind) => `<span class="cm-chip">${kind === 'main' ? ICON.main : ICON.branch}${esc(frame)}</span>`;

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

  function drawLog() {
    const c = chat();
    logEl.innerHTML = c.log.length ? c.log.map((m) => m.who === 'you'
      ? `<div class="cm-m you">${m.frame ? chipOf(m.frame, m.kind) : ''}<p>${esc(m.text)}</p></div>`
      : `<div class="cm-m ${m.who}">${esc(m.text)}${m.view ? ` <button type="button" class="cm-view" data-view="${esc(m.view)}">View</button>` : ''}${m.at ? `<time>${esc(m.at)}</time>` : ''}</div>`).join('')
      : '<p class="cm-empty">Select a frame, then ask for an iteration.</p>';
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

  const say = (c, who, text, view, extra = {}) => {
    c.log.push({ who, text, view, ...extra });
    keep();
    if (c.id === active) drawLog();
  };

  function drawTarget() {
    const ctx = hooks.context();
    targetEl.innerHTML = ctx ? chipOf(ctx.chip, ctx.kind) : '';
    targetEl.hidden = !ctx;
    input.placeholder = !enabled ? (chatWhy || 'Chat is off') : ctx ? 'Ask for an iteration' : 'Ask for a new exploration';
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
    say(c, 'you', message + (extra.length ? ` (${extra.join(', ')})` : ''), undefined, ctx ? { frame: ctx.chip, kind: ctx.kind } : {});
    let answered = false;
    running.set(c.id, { started: Date.now(), status: 'Working' });
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
        : `Finished, with no new version${result.cost ? ` · $${result.cost.toFixed(2)}` : ''}.`, made[0] ? `${made[0].playground}/${made[0].version}` : undefined,
        { at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
      hooks.done(result);
    }
  }
  runEl.querySelector('.cm-stop').addEventListener('click', () => {
    fetch('/playground/chat/stop', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'chat' }, body: JSON.stringify({ tab: active }) });
  });

  // Pasting and dictation (VoiceInk and the like paste with ⌘V, then put the
  // old clipboard back) always reach the box, the first time, as in the
  // classic Claude panel. A ⌘V made while the canvas or a button has the focus
  // moves the focus to the box before the browser pastes, so the paste lands
  // there itself. A paste that lands elsewhere is put in the box, and so is
  // one a live frame passes on (paste()). The clipboard is read only as a last
  // resort, for an app that sends a ⌘V and no paste; a paste that does arrive
  // cancels it. Pasted pictures wait above the box, as screenshots do.
  const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const insert = (text) => {
    if (!text || input.disabled) return;
    input.focus({ preventScroll: true });
    if (!document.execCommand('insertText', false, text)) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  let pasteWait = 0;
  const readLater = () => {
    clearTimeout(pasteWait);
    pasteWait = setTimeout(() => navigator.clipboard?.readText().then(insert).catch(() => {}), 120);
  };
  const IMAGE = /^image\/(png|jpeg|webp|gif)$/;
  const addImage = (dataUrl, note) => {
    const [head, data] = String(dataUrl).split(',');
    if (!data || !/image\/png/.test(head)) return pictureToPng(dataUrl).then((png) => png && addShot(png, note));
    addShot(data, note);
    return Promise.resolve();
  };
  // Any picture as a PNG (base64), which is what the server takes.
  const pictureToPng = (url) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
      c.getContext('2d').drawImage(img, 0, 0);
      ok(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => ok(null);
    img.src = url;
  });
  const readFile = (f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'v' || input.disabled) return;
    if (editable(e.target)) return;
    input.focus({ preventScroll: true });
    if (document.activeElement !== input) readLater();
  }, true);
  document.addEventListener('paste', async (e) => {
    clearTimeout(pasteWait);
    if (input.disabled) return;
    const images = [...(e.clipboardData?.files || [])].filter((f) => IMAGE.test(f.type));
    if (images.length && (!editable(e.target) || e.target === input)) {
      e.preventDefault();
      for (const f of images) await addImage(await readFile(f), 'Pasted');
      return;
    }
    if (editable(e.target)) return; // the box, a note, a search: the browser pastes there itself
    e.preventDefault();
    insert(e.clipboardData?.getData('text/plain'));
  }, true);

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
  function addShot(png, note) {
    pending.push({ png, note, url: `data:image/png;base64,${png}` });
    drawShots();
    input.focus();
  }
  return {
    drawTarget,
    notesEl: root.querySelector('.cm-notes'),
    addShot,
    // A paste a live frame caught (its bridge's `paste`): text, and pictures as data URLs.
    async paste(text, images = []) {
      clearTimeout(pasteWait);
      if (input.disabled) return;
      for (const im of images) await addImage(im.url, 'Pasted');
      if (!images.length) insert(text);
    },
    // A ⌘V a frame saw with no paste after it (a bridge that can't catch one).
    pasteKey() { if (!input.disabled) readLater(); },
  };
}
