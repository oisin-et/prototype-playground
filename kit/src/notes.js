// Notes on the canvas (src/canvas.js), after Agentation. Part of the
// prototype-playground kit.
//
// N turns note mode on. Over a live frame the pointer names the part under it
// (the app's bridge answers `inspect`), outlined; a click opens a note on that
// part, a drag one on an area. The app isn't pressed while note mode is on.
// It stays on, so several notes can be left in a row, until N or Esc.
//
// Each note is pinned to its frame, in the app's own pixels, so it pans and
// zooms with the frame, on the iteration and screen it was left on. Notes
// wait above the composer; Send takes every waiting note to Claude in one
// message (serve.py's save_notes). Claude's answer shows on the pin; a note
// that's done or skipped loses its pin. Notes are kept in this browser only.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const INTENTS = [['fix', 'Fix'], ['change', 'Change'], ['question', 'Question']];
const ANSWER = { sent: 'Sent', done: 'Done', question: 'Question', skipped: 'Skipped' };
const PINNED = ['open', 'sent', 'question'];
const WEEK = 7 * 864e5;

/**
 * o: {
 *   key, W,                      // localStorage prefix; the frames' width in app pixels
 *   stage, frames,
 *   ask(f, message, wait),       // a question to a frame's app
 *   about(f): {screen, screenTitle, params, files, playground, version, label},
 *   goto(note),                  // brings the note's frame into view, on its iteration
 *   listEl,                      // where the waiting notes are listed (the composer's)
 *   changed(),                   // the waiting notes changed (the composer's Send)
 *   enabled(), toast(text),
 * }
 */
export function mountNotes(o) {
  const KEY = `${o.key}.notes`;
  let notes = [];
  try { notes = JSON.parse(localStorage.getItem(KEY)) || []; } catch {}
  notes = notes.filter((x) => PINNED.includes(x.status) || Date.now() - x.created < WEEK);
  let warned = false;
  const keep = () => {
    try { localStorage.setItem(KEY, JSON.stringify(notes)); } catch {
      if (!warned) o.toast("This browser is out of room for the notes' pictures. Send or delete some notes.");
      warned = true;
    }
  };
  const waiting = () => notes.filter((x) => x.status === 'open');
  const nextNumber = () => Math.max(0, ...notes.filter((x) => PINNED.includes(x.status)).map((x) => x.n)) + 1;

  const target = document.createElement('div');
  target.className = 'cv-target';
  target.hidden = true;
  document.body.append(target);
  const marquee = document.createElement('div');
  marquee.className = 'cv-snap note';
  marquee.hidden = true;
  document.body.append(marquee);
  const pop = document.createElement('form');
  pop.className = 'cv-pop';
  pop.hidden = true;
  document.body.append(pop);

  // ---- Where things are: the app's pixels and the page's ----
  const live = (f) => f?.ready && f.iframe;
  const scaleOf = (f) => f.iframe.getBoundingClientRect().width / o.W;
  const toClient = (f, [x, y, w, h]) => {
    const b = f.body.getBoundingClientRect(), k = b.width / o.W;
    return { left: b.left + x * k, top: b.top + y * k, width: w * k, height: h * k, right: b.left + (x + w) * k, bottom: b.top + (y + h) * k };
  };
  const toApp = (f, r) => {
    const b = f.iframe.getBoundingClientRect(), k = b.width / o.W;
    return [(r.left - b.left) / k, (r.top - b.top) / k, r.width / k, r.height / k].map(Math.round);
  };
  const frameAt = (cx, cy) => o.frames.find((f) => {
    if (!live(f)) return false;
    const b = f.iframe.getBoundingClientRect();
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  });

  // ---- Pins: on each frame, the notes left on what it shows now ----
  const onShow = (f, x) => x.frame === f.id && (x.version || null) === (f.v || null) && x.screen === (f.route?.screen ?? f.screen);
  function drawPins(f) {
    let el = f.body.querySelector('.cv-pins');
    if (!el) {
      el = document.createElement('div');
      el.className = 'cv-pins';
      f.body.append(el);
    }
    el.innerHTML = notes.filter((x) => PINNED.includes(x.status) && onShow(f, x)).map((x) => {
      const [bx, by, bw] = x.area || [0, 0, 0];
      return `<button type="button" class="cv-pin ${x.status}${draft?.id === x.id ? ' editing' : ''}" data-pin="${esc(x.id)}" style="left:${bx + bw}px;top:${by}px"
        title="${esc(`${x.n}. ${x.comment}${x.reply ? `\n${ANSWER[x.status]}: ${x.reply}` : ''}`)}">${x.n}</button>`;
    }).join('');
  }
  const drawAllPins = () => o.frames.forEach(drawPins);
  addEventListener('click', (e) => {
    const b = e.target.closest?.('[data-pin]');
    const x = b && notes.find((y) => y.id === b.dataset.pin);
    if (x) { e.stopPropagation(); open(x); }
  }, true);
  addEventListener('pointerdown', (e) => { if (e.target.closest?.('[data-pin]')) e.stopPropagation(); }, true);

  // ---- The waiting notes, listed above the composer ----
  function drawList() {
    const list = waiting();
    o.listEl.hidden = !list.length;
    o.listEl.innerHTML = list.map((x) => `<li><button type="button" class="cv-noted" data-note="${esc(x.id)}">
        <span class="cv-pin-n">${x.n}</span><span class="cv-noted-text"><b>${esc(x.comment)}</b><small>${esc(x.label)}${x.node ? ` · ${esc(x.node.component)}` : ''}</small></span>
      </button><button type="button" class="cv-unnote" data-unnote="${esc(x.id)}" aria-label="Delete note ${x.n}">×</button></li>`).join('');
    drawAllPins();
    o.changed();
  }
  o.listEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-unnote]');
    if (del) { remove(del.dataset.unnote); return; }
    const x = notes.find((y) => y.id === e.target.closest('[data-note]')?.dataset.note);
    if (!x) return;
    o.goto(x);
    setTimeout(() => open(x), 520); // after the view has moved to it
  });
  o.listEl.addEventListener('pointerover', (e) => {
    const id = e.target.closest('[data-note]')?.dataset.note;
    for (const p of document.querySelectorAll('.cv-pin')) p.classList.toggle('lit', p.dataset.pin === id);
  });
  o.listEl.addEventListener('pointerleave', () => { for (const p of document.querySelectorAll('.cv-pin')) p.classList.remove('lit'); });

  // ---- Note mode ----
  let on = false, draft = null, drag = null, hover = null, asking = false, nextHover = null;
  function set(v) {
    on = v && o.enabled();
    if (v && !on) o.toast('Notes go to Claude, and chat is off.');
    o.stage.classList.toggle('noting', on);
    target.hidden = true;
    if (on) o.toast('Notes: click a part of a live frame, or drag over an area. N or Esc to stop.');
  }

  // Names the part under the pointer, one question to the app at a time.
  async function look(cx, cy) {
    if (asking) { nextHover = [cx, cy]; return; }
    const f = frameAt(cx, cy);
    if (!f || draft || drag?.el) { target.hidden = true; hover = null; return; }
    asking = true;
    const b = f.iframe.getBoundingClientRect(), k = b.width / o.W;
    try {
      const m = await o.ask(f, { type: 'inspect', x: (cx - b.left) / k, y: (cy - b.top) / k }, 1500);
      hover = m.box ? { f, area: m.box.map(Math.round), node: { id: m.location, component: m.widget, text: m.text || '' } } : null;
    } catch { hover = null; }
    asking = false;
    if (hover && on && !draft) {
      const r = toClient(hover.f, hover.area);
      Object.assign(target.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      target.dataset.name = hover.node.component || '';
      target.hidden = false;
    } else target.hidden = true;
    if (nextHover) { const [x, y] = nextHover; nextHover = null; look(x, y); }
  }

  // The canvas's pointer, while note mode is on: only over a live frame's
  // app, and not with ⌥ (a screenshot) or Space (a pan) held.
  const mine = (e) => on && e.button === 0 && !e.altKey && !o.stage.classList.contains('grab') && e.target.closest?.('.cv-body') && frameAt(e.clientX, e.clientY);
  o.stage.addEventListener('pointerdown', (e) => {
    if (!mine(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (draft) close();
    drag = { x: e.clientX, y: e.clientY, el: false, f: frameAt(e.clientX, e.clientY) };
    try { o.stage.setPointerCapture(e.pointerId); } catch {}
  }, true);
  o.stage.addEventListener('pointermove', (e) => {
    if (!on) return;
    if (!drag) { look(e.clientX, e.clientY); return; }
    e.stopImmediatePropagation();
    const x = Math.min(drag.x, e.clientX), y = Math.min(drag.y, e.clientY);
    const w = Math.abs(e.clientX - drag.x), h = Math.abs(e.clientY - drag.y);
    if (!drag.el && Math.max(w, h) < 6) return;
    drag.el = true;
    target.hidden = true;
    drag.rect = { left: x, top: y, width: w, height: h };
    marquee.hidden = false;
    marquee.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  }, true);
  const up = async (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    const d = drag;
    drag = null;
    marquee.hidden = true;
    if (d.el) {
      if (d.rect.width > 8 && d.rect.height > 8) create(d.f, { area: toApp(d.f, d.rect), node: null, drag: true });
      return;
    }
    // A click: the part under it (asked again, in case the outline is behind).
    const b = d.f.iframe.getBoundingClientRect(), k = b.width / o.W;
    try {
      const m = await o.ask(d.f, { type: 'inspect', x: (d.x - b.left) / k, y: (d.y - b.top) / k }, 2000);
      if (m.box) create(d.f, { area: m.box.map(Math.round), node: { id: m.location, component: m.widget, text: m.text || '' } });
      else o.toast('Nothing to pin there: drag over an area instead.');
    } catch { o.toast("The frame didn't answer: try again once it has loaded."); }
  };
  o.stage.addEventListener('pointerup', up, true);
  o.stage.addEventListener('pointercancel', () => { drag = null; marquee.hidden = true; }, true);

  // A new note: the part or area, where it is, and a picture of it with a
  // little around it, taken now, while it's on show.
  function create(f, { area, node, drag: isDrag = false }) {
    const pad = isDrag ? 0 : 16;
    const [x, y, w, h] = area;
    const picture = o.ask(f, { type: 'capture', rect: { x: x - pad, y: y - pad, w: w + 2 * pad, h: h + 2 * pad }, scale: 2 }, 8000)
      .then((s) => ({ image: `data:image/png;base64,${s.png}`, covers: isDrag ? s.note || '' : '' }))
      .catch(() => ({}));
    const a = o.about(f);
    open({
      id: `n${Date.now().toString(36)}`, n: nextNumber(), intent: 'change', comment: '', status: 'new',
      frame: f.id, ...a, node, area, drag: isDrag, picture,
    });
  }

  // A node's id, when it says more than its name.
  const idTail = (n) => { const t = String(n.id || '').split('/').pop(); return t && t !== n.component ? t : ''; };

  // The note's popover, beside it: what should change, and whether it's a
  // fix, a change or a question. Claude's answer shows above it.
  function open(x) {
    const f = o.frames.find((y) => y.id === x.frame);
    if (!f) return;
    draft = x;
    target.hidden = true;
    const isNew = x.status === 'new';
    const answer = x.reply && x.status !== 'open' ? `<p class="cv-answer ${esc(x.status)}"><b>${esc(ANSWER[x.status] || x.status)}</b> ${esc(x.reply)}</p>`
      : x.status === 'sent' ? '<p class="cv-answer sent"><b>Sent</b> No answer from Claude yet. Save it to send it again.</p>' : '';
    pop.innerHTML = `
      <div class="cv-pop-head"><span class="cv-pin-n">${x.n}</span>${x.drag || !x.node
        ? `<b>Area</b><small>${x.area[2]} × ${x.area[3]}</small>`
        : `<b>${esc(x.node.component)}</b>${idTail(x.node) ? `<small title="${esc(x.node.id)}">${esc(idTail(x.node))}</small>` : ''}`}</div>
      <p class="cv-pop-where">${esc(x.label)}</p>
      ${answer}
      <textarea rows="3" placeholder="What should change here?" aria-label="Note">${esc(x.comment)}</textarea>
      <div class="cv-intents" role="radiogroup" aria-label="Kind of note">${INTENTS.map(([v, l]) =>
        `<button type="button" role="radio" data-intent="${v}" aria-checked="${x.intent === v}">${l}</button>`).join('')}</div>
      <div class="cv-pop-row">${isNew ? '' : '<button type="button" data-delete>Delete</button>'}<span></span>
        <button type="button" data-cancel>Cancel</button><button type="submit" class="cv-use">${isNew ? 'Add note' : x.status === 'open' ? 'Save' : 'Send again'}</button></div>`;
    pop.hidden = false;
    place();
    const ta = pop.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    drawPins(f);
  }
  // Beside the note's box: to its right if there's room, else its left, kept on the page.
  function place() {
    if (!draft) return;
    const f = o.frames.find((y) => y.id === draft.frame);
    if (!f) return;
    const r = toClient(f, draft.area);
    const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 12;
    let left = r.right + gap;
    if (left + pw > innerWidth - 8) left = r.left - gap - pw;
    if (left < 8) left = Math.min(innerWidth - pw - 8, Math.max(8, r.left));
    const top = Math.min(innerHeight - ph - 8, Math.max(56, r.top));
    Object.assign(pop.style, { left: `${left}px`, top: `${top}px` });
  }
  addEventListener('resize', place);
  function close() {
    if (!draft) return false;
    const f = o.frames.find((y) => y.id === draft.frame);
    draft = null;
    pop.hidden = true;
    if (f) drawPins(f);
    return true;
  }
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !draft) return;
    if (b.dataset.intent) {
      draft.intent = b.dataset.intent;
      for (const r of pop.querySelectorAll('[data-intent]')) r.setAttribute('aria-checked', String(r === b));
    } else if ('cancel' in b.dataset) close();
    else if ('delete' in b.dataset) { const id = draft.id; close(); remove(id); }
  });
  pop.addEventListener('keydown', (e) => {
    e.stopPropagation(); // the canvas's keys aren't for the note
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA') { e.preventDefault(); pop.requestSubmit(); }
  });
  pop.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = draft, comment = pop.querySelector('textarea').value.trim();
    if (!x) return;
    if (!comment) { pop.querySelector('textarea').focus(); return; }
    close();
    x.comment = comment;
    if (x.status === 'new') {
      const { picture, ...rest } = x;
      const note = { ...rest, status: 'open', reply: '', created: Date.now() };
      notes.push(note);
      drawList();
      Object.assign(note, await picture);
    } else if (x.status !== 'open') {
      // Changing a sent or answered note puts it back above the composer, to go again.
      x.status = 'open';
      x.n = nextNumber();
    }
    keep();
    drawList();
  });
  function remove(id) {
    notes = notes.filter((x) => x.id !== id);
    keep();
    drawList();
  }

  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); set(!on); }
    else if (e.key === 'Escape' && (draft || on)) { e.stopImmediatePropagation(); if (!close()) set(false); }
  }, true);

  drawList();
  return {
    get on() { return on; },
    set,
    key(k) { if (k === 'n' || k === 'N') set(!on); else if (k === 'Escape') { if (!close()) set(false); } },
    drawPins,
    // Hides the outline and the popover while the view moves.
    moved() { target.hidden = true; place(); },
    count: () => waiting().length,
    // Send: the waiting notes, as the server takes them; they wait for answers.
    take() {
      const batch = waiting();
      for (const x of batch) x.status = 'sent';
      keep();
      drawList();
      return batch.map(({ status, reply, created, frame, label, ...x }) => x);
    },
    // Claude's answers, from the batch's notes.json when the run ends.
    answered(list = []) {
      const count = {};
      for (const a of list) {
        const x = notes.find((y) => y.id === a.id);
        if (!x || x.status !== 'sent') continue;
        x.status = a.status;
        x.reply = a.reply;
        if (a.status !== 'question') delete x.image;
        count[a.status] = (count[a.status] || 0) + 1;
      }
      keep();
      drawList();
      return Object.entries(count).map(([k, v]) => `${v} ${ANSWER[k].toLowerCase()}`).join(', ');
    },
    // A run that ended without reaching Claude: its notes wait again.
    restore(ids) {
      for (const x of notes) if (ids.includes(x.id) && x.status === 'sent') x.status = 'open';
      keep();
      drawList();
    },
  };
}
