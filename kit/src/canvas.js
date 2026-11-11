// The canvas version of the playground (branch "canvas", Plans: "Playground
// canvas plan"). Part of the prototype-playground kit: the same in every
// project; what's particular to one is in playground/playground.json.
//
// Main and every exploration are frames on one canvas. A frame is the app
// itself, in an iframe, told over postMessage (PROTOCOL.md) which versions to
// lay over its screens: main runs none, an exploration frame runs its one
// iteration. An exploration is a version's major number (v20); its
// iterations (v20.0, v20.1 …) stay inside its frame, behind a stepper.
//
// The foundation (frozen.py has the server's side):
// - The canvas shows Main and its own explorations, and nothing else: the ones
//   in playground/canvas.json, in the order they joined it. An exploration made
//   from the canvas joins it (serve.py); one made in the classic playground
//   stays there. Frames aren't sorted by screen: an exploration is a frame
//   beside main, whatever pages it changes.
// - A frame is one exploration, on the main it started from (its frozen base);
//   its iterations stay inside it, each on that same base. Main is a frame too,
//   the app as it is, and always live.
// - A frame shows what it runs. After a run, every frame on a version the run
//   made or touched runs again, whatever it runs on.
// - A sleeping frame shows its own picture (playground/thumbs/_canvas), taken
//   from its frozen copy, which never changes; or none. Never a picture taken
//   of something else. While nobody's using the canvas, frames without one wake
//   one at a time to have theirs taken.
// - Claude is told the page the selected frame shows (its route), not the page
//   it opened on.
//
// Clicking a frame wakes it and selects it; the selected frame is the one
// Claude works on. ⤢ or F opens a frame to fill the window. While a frame
// fills it, the canvas is locked: it doesn't pan, zoom or fit, no other frame
// can be selected, and only the same button (its icon turned inward), Esc or
// F closes the fill. Inside the
// frame, the app works as ever, and the frame has a zoom of its own: a pinch
// or ⌘-scroll zooms into the app, Space-drag (or a drag or scroll beside it)
// moves around in it, ⇧1 fits it back. The fill stays across a reload.

import { mountComposer } from './composer.js';
import { mountNotes } from './notes.js';
import { mountPanels } from './panels.js';
import { mountCommit } from './commit.js';
import { ICON } from './icons.js';
import { mountXray } from './xray.js';

const load = (path, base) => fetch(new URL(path, base), { cache: 'no-store' }).then((r) => {
  if (!r.ok) throw new Error(`Couldn't load ${path} (${r.status})`);
  return r.json();
});
const loadOptional = (path, base, fallback) => load(path, base).catch(() => fallback);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CFG = await load('../playground.json', import.meta.url);
// Mounted at the end (composer.js, notes.js, panels.js, commit.js); the frames use them once they're there.
let composer = null, notes = null, panels = null, commit = null, xray = null;
let selected = null; // the frame Claude works on (selectFrame)
let focused = null, beforeFocus = null; // the frame that fills the window, and the view to go back to (focusFrame)
let space = false, pan = null; // Space held; a pan under way (setSpace)
let lens = { z: 1, x: 0, y: 0 }; // the zoom inside the frame that fills the window, in its pixels (lensZoom)
const NAME = CFG.name || 'Prototype';
const KEY = `${CFG.key || NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.canvas`;
const DATA = new URL(`/${CFG.data}/`, location.href);
const sizeOf = (s) => (typeof s === 'string' ? s : s?.size);
const [W, H] = (sizeOf(CFG.sizes?.find((s) => sizeOf(s) === CFG.size || s?.name === CFG.size)) || sizeOf(CFG.sizes?.[0]) || '1280x800').split('x').map(Number);
const LIVE_MAX = CFG.canvas?.live || 3;
const PER_ROW = CFG.canvas?.perRow || 8;
const GAP = Math.round(W * 0.08);
const ROW_GAP = Math.round(H * 0.45);

document.getElementById('name').textContent = NAME;
document.title = `${NAME} · Canvas`;
const classic = document.getElementById('classic');
if (CFG.canvas?.classic) classic.href = CFG.canvas.classic; else classic.hidden = true;
classic.innerHTML = ICON.external;
document.getElementById('btn-fit').innerHTML = ICON.fit;
// The ids name what each shows ("left" is the chat), not where: the chat is
// at the right now, Properties and Files at the left.
document.getElementById('btn-left').innerHTML = ICON.right;
document.getElementById('btn-right').innerHTML = ICON.left;
document.getElementById('btn-share').insertAdjacentHTML('afterbegin', ICON.share);

// The side panels: the chat at the right, Properties and Files at the left.
// Closing one gives the canvas its room.
const sides = { left: true, right: true, ...store.get(`${KEY}.sides`, {}) };
function showSide(side, on) {
  sides[side] = on;
  document.body.classList.toggle(`no-${side}`, !on);
  document.getElementById(`btn-${side}`).setAttribute('aria-pressed', String(on));
  store.set(`${KEY}.sides`, sides);
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}
showSide('left', sides.left);
showSide('right', sides.right);
document.getElementById('btn-left').addEventListener('click', () => showSide('left', !sides.left));
document.getElementById('btn-right').addEventListener('click', () => (sides.right ? panels.close() : panels.open(null)));

const toastEl = document.getElementById('toast');
let toastTimer = 0;
const toast = (text) => {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
};

// ---- The explorations, as frames ------------------------------------------
const num = (id) => (id.match(/^v(\d+)\.(\d+)$/) || []).slice(1).map(Number);
const { screens: SCREENS = {} } = await loadOptional('screens.json', DATA, {});
const { playgrounds: IDS = [] } = await loadOptional('index.json', DATA, {});
const playgrounds = (await Promise.all(IDS.map((id) => load(`${id}/versions.json`, DATA)
  .then((pg) => ({ ...pg, id, screen: id.split('/')[0] })).catch(() => null)))).filter(Boolean);
// The explorations on the canvas (serve.py's add_to_canvas), as '<screen>/v<N>'.
const { frames: ON = [] } = await loadOptional('../canvas.json', import.meta.url, {});

// Frozen copies (frozen.py), filled in once the app is up: see syncFrozen().
let frozen = {}; // '<screen>/<version>' → { label, commit, date, made }
const frozenOf = (f) => (f.kind === 'exp' && !f.onMain ? frozen[`${f.pg.id}/${f.v}`] : null);
// What a frame runs: the live app, or one frozen copy. A change means a reload.
const sourceOf = (f) => (frozenOf(f) ? `frozen:${f.pg.id}/${f.v}` : 'live');
const chosen = store.get(`${KEY}.iteration`, {}); // frame id → the iteration on show
const frames = [];
const main = {
  id: 'main', kind: 'main', title: 'Main', sub: 'The app as it is, no versions',
  screen: CFG.canvas?.mainScreen || Object.keys(SCREENS)[0], iters: [], v: null,
};
frames.push(main);
for (const { id } of ON) {
  const [pgId, major] = [id.slice(0, id.lastIndexOf('/')), Number(id.slice(id.lastIndexOf('/') + 2))];
  const pg = playgrounds.find((p) => p.id === pgId);
  const iters = (pg?.versions || []).filter((v) => num(v.id)[0] === major).sort((a, b) => num(a.id)[1] - num(b.id)[1]);
  if (!iters.length) continue; // deleted in the classic playground
  const v = iters.some((x) => x.id === chosen[id]) ? chosen[id] : iters.at(-1).id;
  frames.push({
    id, kind: 'exp', pg, major, iters, v,
    title: iters[0].name, group: pg.title || SCREENS[pg.screen]?.title || pg.id,
    screen: pg.start || pg.screen || pg.on?.[0],
  });
}

// ---- Layout: main first, then each exploration in the order it joined ----
const world = document.getElementById('world');
world.style.setProperty('--fw', `${W}px`);
const stage = document.getElementById('stage');
const shield = document.getElementById('shield');
frames.forEach((f, i) => {
  f.x = (i % PER_ROW) * (W + GAP);
  f.y = Math.floor(i / PER_ROW) * (H + ROW_GAP);
});

const iterOf = (f) => f.iters.find((x) => x.id === f.v);
// The canvas's own pictures (serve.py's save_canvas_thumb): key → when it was taken.
const pictures = await loadOptional('/playground/thumbs?canvas=1', location.href, {});
// A frame's picture: main's, or its frozen copy's. One running on today's main has none kept.
const pictureKey = (f) => (f.kind === 'main' ? 'main' : frozenOf(f) ? `${f.pg.id}/${f.v}` : null);
const pictureUrl = (key) => new URL(`thumbs/_canvas/${key}.png?t=${pictures[key]}`, location.href).href;

for (const f of frames) {
  const el = document.createElement('section');
  el.className = `cv-frame ${f.kind}`;
  el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${W}px;height:${H}px`;
  el.dataset.id = f.id;
  el.innerHTML = `
    <header class="cv-head">
      <span class="cv-title">${f.kind === 'main' ? ICON.main : ICON.branch}<b>${esc(f.kind === 'main' ? 'Main' : `${f.group} ${f.major}`)}</b></span>
      ${f.kind === 'exp' ? `<label class="cv-iter-pick"><span class="cv-iter-now"></span>${ICON.chevron}
        <select aria-label="Iteration">${f.iters.map((x) => `<option value="${esc(x.id)}">${esc(x.id.slice(1))}${x.merged ? ' ✓' : ''} · ${esc(x.name)}</option>`).join('')}</select></label>` : `<span class="cv-iter-now main"></span>`}
    </header>
    <div class="cv-body"><div class="cv-lens">
      <img class="cv-poster" alt="" draggable="false">
      <div class="cv-empty"><b>${esc(f.kind === 'main' ? 'Main' : f.title)}</b><span>Click to open it live</span></div>
      <div class="cv-cover" title="Click to use it live"></div>
    </div></div>
    <footer class="cv-foot"></footer>`;
  f.el = el;
  f.clip = el.querySelector('.cv-body'); // the frame's edge
  f.body = el.querySelector('.cv-lens'); // what's in it: the app and what's laid over it (zoomed while the frame fills the window)
  f.poster = el.querySelector('.cv-poster');
  f.foot = el.querySelector('.cv-foot');
  f.select = el.querySelector('select');
  f.poster.addEventListener('load', () => el.classList.add('has-poster'));
  f.poster.addEventListener('error', () => el.classList.remove('has-poster'));
  if (f.select) {
    f.select.value = f.v;
    f.select.addEventListener('change', () => setIteration(f, f.select.value));
  }
  el.querySelector('.cv-head').addEventListener('pointerdown', () => selectFrame(f));
  world.append(el);
  drawPoster(f);
  drawFoot(f);
}

function drawPoster(f) {
  const shot = f.shots?.[`${f.kind === 'exp' ? sourceOf(f) : 'live'}|${f.v ?? 'main'}`];
  const key = pictureKey(f);
  if (shot) f.poster.src = shot;
  else if (key && pictures[key]) f.poster.src = pictureUrl(key);
  else { f.poster.removeAttribute('src'); f.el.classList.remove('has-poster'); }
}
// Takes the frame's picture once it has settled: kept for this page, and, for
// main or a frozen copy, on the server for the next time.
async function takePicture(f) {
  const source = f.source, v = f.v ?? 'main', key = pictureKey(f);
  await new Promise((r) => setTimeout(r, 2500));
  if (!f.ready || f.source !== source || (f.v ?? 'main') !== v) return false;
  try {
    const shot = await ask(f, { type: 'capture', width: 960 }, 8000);
    (f.shots ??= {})[`${source}|${v}`] = `data:image/png;base64,${shot.png}`;
    if (key && pictureKey(f) === key) {
      await post('/playground/thumbs', 'thumbs', { canvas: key, png: shot.png });
      pictures[key] = Date.now();
    }
    return true;
  } catch { return false; }
}
function drawFoot(f) {
  const now = f.el.querySelector('.cv-iter-now');
  if (f.kind === 'main') {
    if (now) now.textContent = f.where || SCREENS[f.screen]?.title || '';
    f.foot.innerHTML = `<span>${esc(f.where || SCREENS[f.screen]?.title || '')}</span>`;
    if (f === selected) { panels?.drawProps(); drawTools(); }
    return;
  }
  if (now) now.textContent = `${f.v.slice(1)} · ${iterOf(f)?.name || ''}`;
  f.el.classList.toggle('picked', commit?.picked(f.pg.id) === f.v);
  if (f === selected) { panels?.drawProps(); drawTools(); }
  const it = iterOf(f), i = f.iters.indexOf(it), prev = f.iters[i - 1];
  // Where it starts from: said quietly when it's the step before, loudly when
  // it goes back to an earlier one or comes from another exploration.
  let from = '';
  if (it.from) {
    const [fm] = num(it.from);
    const plain = prev && it.from === prev.id;
    from = `<span class="cv-from${plain ? '' : ' jump'}">${plain ? 'from' : '← from'} ${esc(it.from.slice(1))}${fm !== f.major ? ' (another exploration)' : ''}</span>`;
  }
  const built = !f.registry || f.registry[`${f.pg.id}/${f.v}`];
  const fz = frozen[`${f.pg.id}/${f.v}`];
  const when = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
  const mode = f.onMain || !fz ? "on today's main"
    : fz.label === 'frozen' ? `frozen ${when(fz.made?.slice(0, 10))}`
    : fz.label === 'rebuilt' ? `rebuilt on main of ${when(fz.date)}` : "on today's main (no older main in git)";
  const picked = commit?.picked(f.pg.id) === f.v;
  const pickBtn = f.el.querySelector('.cv-pick');
  if (pickBtn) { pickBtn.textContent = picked ? '◆ Picked' : 'Pick'; pickBtn.classList.toggle('on', picked); }
  f.foot.innerHTML = `<span class="cv-iter"><b>${esc(it.id.slice(1))}</b> ${esc(it.name)}</span>${from}${picked ? '<span class="cv-picked">◆ picked for main</span>' : ''}${it.merged ? `<span class="cv-merged">✓ in main ${esc(it.merged)}</span>` : ''}${built ? '' : '<span class="cv-warn">not in the app yet: reload it</span>'}<span class="cv-mode-label${f.onMain || !fz ? ' on-main' : ''}">${esc(mode)}</span><span class="cv-date">${esc(it.date || '')}</span>`;
  f.foot.title = it.note || '';
}

// ---- The app: one server for main and the live frames, one for each frozen copy
let app = null; // { origin, path }
const statusEl = document.getElementById('status');
const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.title = text; statusEl.setAttribute('aria-label', text); };
const watchApp = async () => {
  const s = await fetch('/playground/app', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!s) { setStatus('error', 'No app: run playground serve.py'); return; }
  if (s.state === 'ready' || s.state === 'waiting') {
    const first = !app;
    app = { origin: `http://${s.host || '127.0.0.1'}:${s.port}`, path: s.path || '/' };
    if (first) {
      setStatus('busy', 'Loading the frozen copies…');
      await syncFrozen();
      setStatus('ready', 'App ready');
      wake(main); // main is always live
      const sel = focused || frames.find((f) => f.id === store.get(`${KEY}.selected`));
      if (sel) { selectFrame(sel); }
      fillPictures();
    }
  } else if (s.state === 'starting') setStatus('busy', 'Building the app…');
  else setStatus('error', "The app isn't running");
};

// Frozen copies (frozen.py): every iteration as it was the day it was made.
// An exploration frame shows its frozen copy unless it's switched to "On main"
// (the iteration laid over today's main, as the classic playground does).
let freezing = null;
const post = (url, kind, body = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': kind }, body: JSON.stringify(body),
}).then((r) => (r.status === 204 ? {} : r.json())).catch(() => null);
// Fetches the frozen copies (and freezes any version made some other way).
// One at a time: a second call waits for the one under way.
function syncFrozen() {
  freezing ??= (async () => {
    const r = await post('/playground/frozen/sync', 'frozen');
    if (r?.enabled) {
      frozen = r.versions || {};
      // A sleeping frame's picture is its frozen copy's, known only now.
      for (const f of frames) if (f.kind === 'exp') { drawMode(f); drawFoot(f); if (!f.iframe) drawPoster(f); }
    }
  })().finally(() => { freezing = null; });
  return freezing;
}
setInterval(() => { if (!document.hidden && app) syncFrozen(); }, 60000);
watchApp();
setInterval(() => { if (!document.hidden) watchApp(); }, 3000);

const send = (f, m) => { if (f.iframe && f.origin) f.iframe.contentWindow?.postMessage(JSON.stringify(m), f.origin); };
const layersOf = (f) => (f.kind === 'main' ? [] : [`${f.pg.id}/${f.v}`]);

const liveOrder = [];
async function wake(f) {
  if (!app) { toast('The app is still starting.'); return; }
  if (f.iframe) { if (f !== main) { liveOrder.splice(liveOrder.indexOf(f), 1); liveOrder.push(f); } return; }
  const source = sourceOf(f);
  let origin = app.origin;
  if (source !== 'live') {
    const r = await post('/playground/frozen/open', 'frozen', { key: source.slice(7) });
    if (!r?.port) { toast(`The frozen copy of ${f.v.slice(1)} isn't there: it runs on today's main.`); f.onMain = true; drawMode(f); }
    else origin = `http://127.0.0.1:${r.port}`;
  }
  if (f.iframe) return; // woken twice while waiting
  const iframe = document.createElement('iframe');
  iframe.title = f.kind === 'main' ? 'Main' : `${f.group} ${f.major}: ${f.title}`;
  const u = new URL(app.path, origin);
  u.searchParams.set('playground', location.origin);
  iframe.src = u.href;
  f.iframe = iframe; f.ready = false; f.origin = origin; f.source = sourceOf(f);
  f.body.append(iframe);
  f.el.classList.add('live', 'loading');
  if (f === main) return; // always live, and not counted
  liveOrder.push(f);
  while (liveOrder.length > LIVE_MAX) {
    const old = liveOrder.find((x) => x !== selected && x !== focused);
    if (!old) break;
    sleep(old);
  }
}
async function sleep(f, picture = true) {
  const i = liveOrder.indexOf(f);
  if (i >= 0) liveOrder.splice(i, 1);
  if (f.ready && picture) {
    // A picture of it as it was, so the frame looks the same asleep.
    const v = f.v ?? 'main', src = f.source;
    try {
      const shot = await ask(f, { type: 'capture', width: 960 });
      (f.shots ??= {})[`${src}|${v}`] = `data:image/png;base64,${shot.png}`;
    } catch {}
  }
  f.iframe?.remove();
  f.iframe = null; f.ready = false; f.origin = null;
  f.el.classList.remove('live', 'loading');
  drawPoster(f);
}
// Runs the frame again from what it should run now (another frozen copy, or live).
let reloadTimers = new Map();
function rerun(f) {
  f.el.classList.add('loading');
  drawPoster(f);
  clearTimeout(reloadTimers.get(f));
  reloadTimers.set(f, setTimeout(async () => {
    const wasLive = !!f.iframe;
    if (wasLive) await sleep(f, false);
    if (wasLive || f === selected || f === focused) wake(f);
  }, 250));
}

const pending = new Map();
let askId = 0;
const ask = (f, m, wait = 2500) => new Promise((ok, fail) => {
  const id = `cv${++askId}`;
  pending.set(id, { ok, fail });
  send(f, { ...m, id });
  setTimeout(() => { if (pending.delete(id)) fail(new Error('No answer')); }, wait);
});

addEventListener('message', (e) => {
  const f = frames.find((x) => x.iframe && x.iframe.contentWindow === e.source);
  if (!f || e.origin !== f.origin) return;
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  if (m.type === 'hello') {
    f.registry = m.versions || {};
    f.ready = true;
    f.el.classList.remove('loading');
    send(f, { type: 'layers', layers: layersOf(f) });
    if (f.screen) send(f, { type: 'show', screen: f.screen });
    drawFoot(f);
    const key = pictureKey(f);
    if (f === main || (key && (!pictures[key] || f.repicture))) takePicture(f).then((ok) => { if (ok) f.repicture = false; f.pictured?.(ok); });
  } else if (m.type === 'where') {
    f.where = m.title || SCREENS[m.screen]?.title || m.screen;
    f.route = { screen: m.screen, params: m.params || {} };
    if (f.kind === 'main') drawFoot(f);
    notes?.drawPins(f);
    panels?.changed(f);
  } else if (['captured', 'inspected', 'located', 'pictured', 'drawn', 'xrayed'].includes(m.type)) {
    const p = pending.get(m.id);
    if (p) { pending.delete(m.id); m.error ? p.fail(new Error(m.error)) : p.ok(m); }
  } else if (m.type === 'errors') {
    toast(`${f.title}: ${m.errors?.[0] || 'a version failed'}`);
  } else if (m.type === 'wheel') {
    // A pinch or ⌘-scroll over the app: zoom the canvas around the pointer.
    const r = f.iframe.getBoundingClientRect(), k = r.width / W;
    zoomAt(Math.exp(-m.dy * 0.01), r.left + m.x * k, r.top + m.y * k);
  } else if (m.type === 'key') {
    if (m.key === 'Space') setSpace(m.down);
    else if (m.key === 'Alt') setSnap(m.down);
    else if (m.key === 'Shift') xray?.shift(m.down);
    else if (m.key === 'n') notes.key('n');
    else if (m.key === 'i') panels.inspector.set(!panels.inspector.on);
    else if (m.key === 'p') panels.toggle();
    else if (m.key === 'Escape' && m.down !== false) {
      if (notes.on) notes.key('Escape'); else if (panels.inspector.on) panels.inspector.set(false); else if (!xray?.escape() && !readerOpen()) unfocus();
    }
  } else if (m.type === 'leaving') {
    // The frame's page is going away (a reload): until the next one has a
    // bridge, a frame with the focus would swallow every key, a dictation's ⌘V too.
    if (document.activeElement === f.iframe) { f.iframe.blur(); window.focus(); }
  } else if (m.type === 'paste') {
    composer.paste(m.text, m.images);
  } else if (m.type === 'pastekey') {
    composer.pasteKey();
  } else if (m.type === 'zoomkey') {
    zoomKey({ in: '+', out: '-', actual: '0', fit: '!' }[m.key] || m.key);
  }
});

// ---- Iterations -------------------------------------------------------------
function setIteration(f, id) {
  if (!f.iters.some((x) => x.id === id) || f.v === id) return;
  f.v = id;
  chosen[f.id] = id;
  store.set(`${KEY}.iteration`, chosen);
  if (f.select) f.select.value = id;
  if (f.iframe && sourceOf(f) !== f.source) rerun(f);
  else if (f.ready) {
    send(f, { type: 'layers', layers: layersOf(f) });
    if (f.screen) send(f, { type: 'show', screen: f.screen });
  } else drawPoster(f);
  drawMode(f);
  drawFoot(f);
  notes?.drawPins(f);
  panels?.changed(f);
  if (f === selected) drawTarget();
}
// The switch in an exploration's head: its frozen copy, or on today's main.
function drawMode(f) {
  if (f === selected) drawTools();
}
function toggleMode(f) {
  f.onMain = !f.onMain;
  drawMode(f);
  drawFoot(f);
  if (f.iframe) rerun(f);
}
const step = (f, d) => {
  const i = f.iters.findIndex((x) => x.id === f.v);
  const next = f.iters[Math.max(0, Math.min(f.iters.length - 1, i + d))];
  if (next) setIteration(f, next.id);
};

// ---- Selection: the frame Claude works on ----------------------------------
const drawTarget = () => composer?.drawTarget();
// What the composer tells Claude about the selected frame.
// The page is the one the frame shows now (its route, from the bridge's
// "where"), not the one it opened on: serve.py's canvas_context says it.
function context() {
  const f = selected;
  if (!f) return null;
  const screen = f.route?.screen ?? f.screen;
  const page = {
    surface: 'canvas', screen, params: f.route?.params || {},
    screenTitle: (f.route && f.where) || SCREENS[screen]?.title || screen,
    files: SCREENS[screen]?.file ? [SCREENS[screen].file] : [],
  };
  if (f.kind === 'main') return { chip: 'Main', kind: 'main', body: { ...page, frame: 'main' } };
  return {
    chip: `${f.group} ${f.v.slice(1)}`, kind: 'exp',
    body: { ...page, frame: 'exp', playground: f.pg.id, version: f.v, name: iterOf(f)?.name, onMain: !frozenOf(f) },
  };
}
function selectFrame(f) {
  if (focused && f !== focused) return; // locked to the frame that fills the window
  if (selected !== f) {
    selected?.el.classList.remove('selected');
    selected = f;
    f?.el.classList.add('selected');
    store.set(`${KEY}.selected`, f?.id ?? null);
    drawTarget();
    panels?.selected(f);
  }
  drawTools();
  if (f) wake(f);
}

// ---- The frame toolbar: above the selected frame, our tools as icons ----------
const tools = document.getElementById('tools');
const TOOLS = [
  ['note', 'Notes: click a part to pin a note (N)', ICON.note],
  ['inspect', 'Inspect: which component each part is (I)', ICON.inspect],
  ['xray', 'X-ray: drag to see sizes, padding and gaps (or hold ⇧ and drag)', ICON.xray],
  ['shot', 'Screenshot: drag over the frame (or hold ⌥ and drag)', ICON.shot],
  '|',
  ['frozen', '', ICON.frozen, 'exp'],
  ['pick', '', ICON.pick, 'exp'],
  '|',
  ['files', 'The files behind this frame', ICON.files],
  ['reload', 'Load it again', ICON.reload],
  ['fill', 'Fill the window (F)', ICON.fill],
];
tools.innerHTML = TOOLS.map((t) => (t === '|' ? '<span class="cv-tsep"></span>'
  : `<button type="button" class="cv-icon" data-tool="${t[0]}" title="${esc(t[1])}" aria-label="${esc(t[1] || t[0])}"${t[3] ? ` data-only="${t[3]}"` : ''}>${t[2]}</button>`)).join('');
tools.addEventListener('pointerdown', (e) => e.stopPropagation());
tools.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  const f = selected;
  if (!b || !f) return;
  const t = b.dataset.tool;
  if (t === 'note') notes.set(!notes.on);
  else if (t === 'inspect') panels.inspector.set(!panels.inspector.on);
  else if (t === 'xray') xray.arm(!xray.armed);
  else if (t === 'shot') { aiming = !aiming; setSnap(aiming); }
  else if (t === 'frozen') toggleMode(f);
  else if (t === 'pick') commit?.pick(f.pg.id, f.v);
  else if (t === 'files') panels.open(f, 'files');
  else if (t === 'reload') { if (f.iframe) rerun(f); else wake(f); }
  else if (t === 'fill') { if (focused === f) unfocus(); else focusFrame(f); }
  drawTools();
});
function drawTools() {
  const f = selected;
  tools.hidden = !f;
  if (!f) return;
  const set = (t, on, title) => {
    const b = tools.querySelector(`[data-tool=${t}]`);
    b.setAttribute('aria-pressed', String(!!on));
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
  };
  for (const b of tools.querySelectorAll('[data-only]')) b.hidden = b.dataset.only !== f.kind;
  set('note', notes?.on);
  set('inspect', panels?.inspector.on);
  set('xray', xray?.armed);
  set('shot', snapping);
  set('fill', focused === f, focused === f ? 'Back to the canvas (Esc)' : 'Fill the window (F)');
  const fill = tools.querySelector('[data-tool=fill]'), icon = focused === f ? ICON.unfill : ICON.fill;
  if (fill.innerHTML !== icon) fill.innerHTML = icon;
  if (f.kind === 'exp') {
    const fz = frozen[`${f.pg.id}/${f.v}`];
    tools.querySelector('[data-tool=frozen]').hidden = !fz;
    set('frozen', fz && !f.onMain, f.onMain ? "On today's main: click for its own base" : `On main as it was ${(fz?.base || fz?.date || '').slice(0, 10)}: click to lay it over today's main`);
    const picked = commit?.picked(f.pg.id) === f.v;
    set('pick', picked, picked ? 'Picked for main: click to unpick' : 'Pick this iteration for main: Commit moves it into the app');
  }
  placeTools();
}
// Right-aligned over the frame's top edge, kept inside the canvas.
function placeTools() {
  const f = selected;
  if (!f || tools.hidden) return;
  const s = stage.getBoundingClientRect(), b = f.clip.getBoundingClientRect();
  const w = tools.offsetWidth, h = tools.offsetHeight;
  // Fixed to the frame's top right, like its name: it pans with the frame and
  // never slides along the stage's edge onto the screen.
  const left = b.right - s.left - w, top = b.top - s.top - h - 10;
  const off = left + w < 0 || left > s.width || top + h < 0 || top > s.height;
  tools.style.visibility = off ? 'hidden' : '';
  tools.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}
let aiming = false; // the toolbar's screenshot: one drag, without ⌥

// ---- The view: pan and zoom --------------------------------------------------
const VIEW_KEY = `${KEY}.view`;
const view = { x: 40, y: 80, z: 0.12, ...store.get(VIEW_KEY, {}) };
const ZMIN = 0.02, ZMAX = 2;
const zoomLabel = document.getElementById('zoom-label');
let saveTimer = 0;
function draw(glide = false) {
  world.classList.toggle('glide', glide && !matchMedia('(prefers-reduced-motion: reduce)').matches);
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  world.style.setProperty('--inv', String(1 / view.z));
  // Small frames keep only their names; tiny ones not even those.
  world.classList.toggle('small', W * view.z < 420);
  world.classList.toggle('tiny', W * view.z < 90);
  zoomLabel.textContent = `${Math.round(view.z * (focused ? lens.z : 1) * 100)}%`;
  notes?.moved();
  if (glide) { const t0 = performance.now(); const follow = () => { placeTools(); if (performance.now() - t0 < 520) requestAnimationFrame(follow); }; requestAnimationFrame(follow); }
  else placeTools();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(VIEW_KEY, { x: view.x, y: view.y, z: view.z }), 300);
}
function zoomAt(k, px, py, glide = false) {
  if (focused) { lensZoom(k, px, py); return; } // the canvas is locked: the frame zooms
  const s = stage.getBoundingClientRect();
  const z = Math.min(ZMAX, Math.max(ZMIN, view.z * k));
  const cx = px - s.left, cy = py - s.top;
  view.x = cx - (cx - view.x) * (z / view.z);
  view.y = cy - (cy - view.y) * (z / view.z);
  view.z = z;
  draw(glide);
}
// Fits a box of the world into the stage, leaving room for the heads and feet.
function fitBox(x0, y0, x1, y1, pad = 48) {
  const s = stage.getBoundingClientRect();
  const z = Math.min(ZMAX, Math.max(ZMIN, Math.min((s.width - pad * 2) / (x1 - x0), (s.height - pad * 2 - 80) / (y1 - y0))));
  view.z = z;
  view.x = (s.width - (x1 - x0) * z) / 2 - x0 * z;
  view.y = (s.height - (y1 - y0) * z) / 2 - y0 * z;
  draw(true);
}
const fitAll = () => {
  if (focused) { resetLens(); return; } // the canvas is locked: the frame fits
  const xs = frames.map((f) => f.x), ys = frames.map((f) => f.y);
  fitBox(Math.min(...xs) - GAP, Math.min(...ys) - H * 0.25, Math.max(...xs) + W + GAP, Math.max(...ys) + H);
};
const btnFit = document.getElementById('btn-fit');
btnFit.addEventListener('click', () => fitAll());
// The view is kept, unless the frames have changed since: then all of them.
const LAYOUT_KEY = `${KEY}.layout`, layout = frames.map((f) => f.id).join(' ');
if (!store.get(VIEW_KEY, null) || store.get(LAYOUT_KEY, null) !== layout) requestAnimationFrame(fitAll); else draw();
store.set(LAYOUT_KEY, layout);

// ⤢: the frame fills the window, and the canvas is locked until the same ⤢
// (or F) goes back to where the view was. Kept, so a reload keeps it.
const FILL_KEY = `${KEY}.fill`;
const frameName = (f) => (f.kind === 'main' ? 'Main' : `${f.group} ${f.major}`);
function lockTo(f, glide = true) {
  focused?.el.classList.remove('focused');
  focused = f;
  f.el.classList.add('focused');
  stage.classList.add('focusing');
  fitTitle('Fit the frame (⇧1)');
  setSpace(false);
  const s = stage.getBoundingClientRect();
  const z = Math.min(ZMAX, Math.max(ZMIN, Math.min((s.width - 32) / W, (s.height - 32 - 80) / H)));
  Object.assign(view, { z, x: (s.width - W * z) / 2 - f.x * z, y: (s.height - H * z) / 2 - f.y * z });
  draw(glide);
  clampLens();
  drawLens();
}
const fitTitle = (t) => { btnFit.title = t; btnFit.setAttribute('aria-label', t.replace(/ \(.*\)$/, '')); };

// Inside the frame that fills the window: its own zoom, in the frame's pixels,
// on the layer that holds the app and what's laid over it (notes, X-ray,
// Inspect), so they stay in step. The frame's edge and the canvas don't move.
const LENS_MAX = 4; // up to 400% of the app's own pixels
function drawLens() {
  const f = focused;
  if (!f) return;
  const { x, y, z } = lens;
  f.body.style.transform = z === 1 ? '' : `translate(${x}px, ${y}px) scale(${z})`;
  f.body.style.setProperty('--inv', String(1 / (view.z * z))); // what keeps its size on screen
  zoomLabel.textContent = `${Math.round(view.z * z * 100)}%`;
  notes?.moved();
  store.set(FILL_KEY, { id: f.id, before: beforeFocus, lens });
}
function clampLens() {
  lens.z = Math.min(Math.max(1, LENS_MAX / view.z), Math.max(1, lens.z));
  lens.x = Math.min(0, Math.max(W - W * lens.z, lens.x));
  lens.y = Math.min(0, Math.max(H - H * lens.z, lens.y));
}
// Screen pixels per frame pixel at the frame's own size.
const clipScale = () => focused.clip.getBoundingClientRect().width / W;
function lensZoom(k, px, py) {
  const b = focused.clip.getBoundingClientRect(), s0 = b.width / W;
  const cx = (px - b.left) / s0, cy = (py - b.top) / s0, z0 = lens.z;
  lens.z = z0 * k;
  clampLens();
  lens.x = cx - (cx - lens.x) * (lens.z / z0);
  lens.y = cy - (cy - lens.y) * (lens.z / z0);
  clampLens();
  drawLens();
}
function lensPan(dx, dy) { // screen pixels
  const s0 = clipScale();
  lens.x += dx / s0; lens.y += dy / s0;
  clampLens();
  drawLens();
}
function resetLens() { lens = { z: 1, x: 0, y: 0 }; drawLens(); }
function focusFrame(f) {
  if (focused && f !== focused) return; // one fill at a time: close it first
  if (!focused) beforeFocus = { ...view };
  lockTo(f);
  drawTools();
  wake(f);
}
function unfocus() {
  if (!focused) return false;
  focused.el.classList.remove('focused');
  stage.classList.remove('focusing');
  focused.body.style.transform = '';
  focused.body.style.removeProperty('--inv');
  lens = { z: 1, x: 0, y: 0 };
  focused = null;
  fitTitle('Show every frame (⇧1)');
  store.set(FILL_KEY, null);
  drawTools();
  if (beforeFocus) { Object.assign(view, beforeFocus); draw(true); }
  return true;
}
{
  const fill = store.get(FILL_KEY, null), f = fill && frames.find((x) => x.id === fill.id);
  if (f) { beforeFocus = fill.before; lens = { ...lens, ...fill.lens }; requestAnimationFrame(() => lockTo(f, false)); } // selected once the app is up
  else store.set(FILL_KEY, null);
}

// What opens over the canvas (the readers of Files and Library) scrolls
// itself: the wheel and the pointer there are its own, not the canvas's.
const overCanvas = (e) => e.target instanceof Element && e.target.closest('#workspace > *');
// A reader open over the canvas takes the first Esc (it closes itself).
const readerOpen = () => !!document.querySelector('#workspace > :not([hidden])');
stage.addEventListener('wheel', (e) => {
  if (overCanvas(e)) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.004)), e.clientX, e.clientY);
  else if (focused) lensPan(-e.deltaX, -e.deltaY); // the canvas is locked: move inside the frame
  else { view.x -= e.deltaX; view.y -= e.deltaY; draw(); }
}, { passive: false });

// Drag the background (or anything, with Space held) to pan. While a pan is
// on, the shield keeps the live frames from taking the pointer.
function setSpace(down) {
  space = down; // while a frame fills the window, Space-drag moves inside it
  document.body.classList.toggle('pg-space', space);
  stage.classList.toggle('grab', space);
  shield.hidden = !space && !pan;
}
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || overCanvas(e)) return;
  const onCover = e.target.closest('.cv-cover');
  const onBg = e.target === stage || e.target === world || e.target === shield;
  if (!space && !onCover && !onBg) return;
  pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, lx: lens.x, ly: lens.y, moved: false, cover: onCover && !space ? onCover : null };
  shield.hidden = false;
  try { stage.setPointerCapture(e.pointerId); } catch {}
});
stage.addEventListener('pointermove', (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
  if (!pan.moved) return;
  if (focused) { const s0 = clipScale(); lens.x = pan.lx + dx / s0; lens.y = pan.ly + dy / s0; clampLens(); drawLens(); } // the canvas is locked
  else { view.x = pan.vx + dx; view.y = pan.vy + dy; draw(); }
});
const endPan = () => {
  if (!pan) return;
  if (!pan.moved && pan.cover) selectFrame(frames.find((f) => f.el.contains(pan.cover)));
  else if (!pan.moved && !space && !focused) { selected?.el.classList.remove('selected'); selected = null; drawTarget(); }
  pan = null;
  shield.hidden = !space;
};
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

function zoomKey(key) {
  const s = stage.getBoundingClientRect();
  if (key === '+' || key === '=') zoomAt(1.25, s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '-') zoomAt(0.8, s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '0') zoomAt(1 / (view.z * (focused ? lens.z : 1)), s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '!' || key === '1') fitAll();
}
const typing = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); if (!space) setSpace(true); return; }
  if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '0'].includes(e.key)) { e.preventDefault(); zoomKey(e.key); return; }
  if (typing(e.target)) return;
  if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) { e.preventDefault(); fitAll(); }
  else if (e.key === 'Escape') { if (readerOpen()) return; if (!unfocus()) { selected?.el.classList.remove('selected'); selected = null; drawTarget(); } }
  else if (selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.iters.length > 1) { e.preventDefault(); step(selected, e.key === 'ArrowLeft' ? -1 : 1); }
  else if (selected && (e.key === 'f' || e.key === 'F')) { focused === selected ? unfocus() : focusFrame(selected); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') setSpace(false); });
// A click inside a live frame moves the focus into its iframe: that frame
// becomes the selected one.
addEventListener('blur', () => {
  setSpace(false);
  setTimeout(() => {
    const f = frames.find((x) => x.iframe && x.iframe === document.activeElement);
    if (f && f !== selected) selectFrame(f);
  });
});
addEventListener('resize', () => { if (focused) lockTo(focused, false); });

// ---- Claude: the composer, and what a run made --------------------------------
composer = mountComposer(document.getElementById('composer'), {
  key: KEY,
  context,
  toast,
  view: (key) => showVersion(key),
  done: (result) => afterRun(result),
  notes: () => notes,
});

// What a note says about where it was left: the screen on show, the files
// it's drawn from, and the version, as serve.py's notes take it.
function about(f) {
  const screen = f.route?.screen ?? f.screen;
  const title = (f.route && f.where) || SCREENS[screen]?.title || screen;
  const exp = f.kind === 'exp';
  return {
    screen, screenTitle: title, params: f.route?.params || {},
    files: exp ? [`${CFG.data}/${f.pg.id}/${f.v}/`] : SCREENS[screen]?.file ? [SCREENS[screen].file] : [],
    playground: exp ? f.pg.id : null, version: exp ? f.v : null,
    label: exp ? `${f.group} ${f.v.slice(1)} · ${title}` : `Main · ${title}`,
  };
}
notes = mountNotes({
  key: KEY, W, stage, frames, ask, about, toast,
  listEl: composer.notesEl,
  enabled: () => true,
  onStart: () => panels?.inspector.set(false),
  changed: () => {},
  goto(x) {
    const f = frames.find((y) => y.id === x.frame);
    if (!f) return;
    if (focused && f !== focused) { toast(`That note is on ${frameName(f)}. ${frameName(focused)} fills the window: ⤢ closes it.`); return; }
    if (x.version && f.v !== x.version) setIteration(f, x.version);
    selectFrame(f);
    focusFrame(f);
    if (f.ready && x.screen && f.route?.screen !== x.screen) send(f, { type: 'show', screen: x.screen, params: x.params });
  },
});

// Opens a version's frame on that iteration, and selects it.
function showVersion(key) {
  const [pgId, v] = [key.slice(0, key.lastIndexOf('/')), key.slice(key.lastIndexOf('/') + 1)];
  const major = num(v)[0];
  const f = frames.find((x) => x.kind === 'exp' && x.pg.id === pgId && x.major === major);
  if (!f) return false;
  setIteration(f, v);
  if (focused && f !== focused) {
    toast(`${pgId} ${v.slice(1)} is ready, in ${frameName(f)}. ${frameName(focused)} fills the window: ⤢ closes it.`);
    return 'locked';
  }
  selectFrame(f);
  focusFrame(f);
  return true;
}

// What a run said before the page laid out again.
const NOTICE_KEY = `${KEY}.notice`;
{ const n = store.get(NOTICE_KEY, null); if (n) { store.set(NOTICE_KEY, null); setTimeout(() => toast(n), 800); } }

// After a run: the versions it made or changed. A new iteration joins its
// frame; a new exploration needs a place on the canvas, so the page lays out
// again (keeping the view and the selection). Every frame on a version the run
// touched runs again, whatever it runs on, and has its picture taken again.
async function afterRun(result) {
  const made = [...(result.new || []), ...(result.updated || [])];
  if (!made.length) return;
  if (result.updated?.length) toast(`Claude changed ${result.updated.map((x) => `${x.playground} ${x.version.slice(1)}`).join(', ')} in place.`);
  await syncFrozen(); // new.py and iterate.py froze theirs as they made them
  let relayout = false;
  for (const id of new Set(made.map((x) => x.playground))) {
    const pg = playgrounds.find((p) => p.id === id);
    const fresh = await load(`${id}/versions.json`, DATA).catch(() => null);
    if (!pg || !fresh) { relayout = true; continue; }
    pg.versions = fresh.versions;
    for (const v of fresh.versions) {
      const n = num(v.id);
      if (!n.length) continue;
      const f = frames.find((x) => x.kind === 'exp' && x.pg.id === id && x.major === n[0]);
      // A new exploration from this run joins the canvas (serve.py); the screen's others aren't on it.
      if (!f) { if (made.some((x) => x.playground === id && num(x.version)[0] === n[0])) relayout = true; continue; }
      const i = f.iters.findIndex((x) => x.id === v.id);
      if (i >= 0) f.iters[i] = v; else f.iters.push(v);
      f.iters.sort((a, b) => num(a.id)[1] - num(b.id)[1]);
    }
  }
  const first = made[0], key = `${first.playground}/${first.version}`;
  if (relayout) {
    const major = num(first.version)[0];
    chosen[`${first.playground}/v${major}`] = first.version;
    store.set(`${KEY}.iteration`, chosen);
    if (!focused) store.set(`${KEY}.selected`, `${first.playground}/v${major}`);
    store.set(NOTICE_KEY, focused ? `${first.playground} ${first.version.slice(1)} is on the canvas. ${frameName(focused)} fills the window: ⤢ closes it.` : null);
    toast(`${first.playground} ${first.version.slice(1)} is ready: laying the canvas out again…`);
    setTimeout(() => location.reload(), 1200);
    return;
  }
  const touched = new Set(made.map((x) => `${x.playground}/${x.version}`));
  for (const f of frames) {
    if (f.kind !== 'exp' || !made.some((x) => x.playground === f.pg.id)) continue;
    if (f.select) f.select.innerHTML = f.iters.map((x) => `<option value="${esc(x.id)}">${esc(x.id.slice(1))}${x.merged ? ' ✓' : ''} · ${esc(x.name)}</option>`).join('');
    if (f.select) f.select.value = f.v;
    if (!touched.has(`${f.pg.id}/${f.v}`)) continue;
    // What it showed is out of date: forget its pictures, and run it again.
    f.shots = {};
    f.repicture = true;
    if (f.iframe) rerun(f); else drawPoster(f);
  }
  // The live app compiles its versions in as it loads: main loads again too.
  if (main.iframe) rerun(main);
  if (showVersion(key) !== 'locked') toast(`${first.playground} ${first.version.slice(1)} is ready.`);
}

// ---- Pictures for frames that have none ------------------------------------------
// While nobody's using the canvas, a frame without a picture wakes, has it
// taken, and sleeps again: one at a time, the nearest to the middle first.
// A frozen copy's picture is taken once: the copy never changes.
let lastInput = 0, filling = null;
for (const type of ['pointerdown', 'wheel', 'keydown']) addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
const tried = new Set();
function fillPictures() {
  setInterval(async () => {
    if (filling || focused || document.hidden || !app || Date.now() - lastInput < 4000) return;
    const s = stage.getBoundingClientRect();
    const cx = (s.width / 2 - view.x) / view.z, cy = (s.height / 2 - view.y) / view.z;
    const todo = frames.filter((f) => f.kind === 'exp' && !f.iframe && !tried.has(f.id + f.v)
      && pictureKey(f) && (!pictures[pictureKey(f)] || f.repicture));
    if (!todo.length) return;
    const dist = (f) => Math.hypot(f.x + W / 2 - cx, f.y + H / 2 - cy);
    const f = todo.sort((a, b) => dist(a) - dist(b))[0];
    tried.add(f.id + f.v);
    filling = f;
    const done = new Promise((ok) => { f.pictured = ok; setTimeout(() => ok(false), 25000); });
    await wake(f);
    await done;
    f.pictured = null;
    if (f.iframe && f !== selected && f !== focused) await sleep(f, false);
    drawPoster(f);
    filling = null;
  }, 1500);
}

// ---- Screenshots: hold ⌥ and drag over a live frame -------------------------------
const snapBox = document.createElement('div');
snapBox.className = 'cv-snap';
snapBox.hidden = true;
stage.append(snapBox);
let snapping = false, snap = null;
function setSnap(down) {
  if (!down) aiming = false;
  snapping = down || aiming;
  down = snapping;
  document.body.classList.toggle('pg-alt', down);
  stage.classList.toggle('snapping', down || !!snap);
  shield.hidden = !down && !snap && !space && !pan;
}
addEventListener('keydown', (e) => { if (e.key === 'Alt' && !typing(e.target)) setSnap(true); });
addEventListener('keyup', (e) => { if (e.key === 'Alt') setSnap(false); });
stage.addEventListener('pointerdown', (e) => {
  if (!snapping || e.button !== 0) return;
  e.stopImmediatePropagation();
  const s = stage.getBoundingClientRect();
  snap = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, s };
  try { stage.setPointerCapture(e.pointerId); } catch {}
  drawSnap();
}, true);
stage.addEventListener('pointermove', (e) => {
  if (!snap) return;
  e.stopImmediatePropagation();
  snap.x1 = e.clientX; snap.y1 = e.clientY;
  drawSnap();
}, true);
const endSnap = async (e) => {
  if (!snap) return;
  e.stopImmediatePropagation();
  const r = { x: Math.min(snap.x0, snap.x1), y: Math.min(snap.y0, snap.y1), w: Math.abs(snap.x1 - snap.x0), h: Math.abs(snap.y1 - snap.y0) };
  snap = null;
  snapBox.hidden = true;
  aiming = false;
  setSnap(false);
  drawTools();
  if (r.w < 8 || r.h < 8) return;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const f = frames.find((x) => {
    if (!x.ready) return false;
    const b = x.iframe.getBoundingClientRect();
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  });
  if (!f) { toast('Drag over a live frame: click a frame first to wake it.'); return; }
  const b = f.iframe.getBoundingClientRect(), k = b.width / W;
  const rect = { x: (r.x - b.left) / k, y: (r.y - b.top) / k, w: r.w / k, h: r.h / k };
  try {
    const shot = await ask(f, { type: 'capture', rect, scale: 2 }, 8000);
    const where = f.kind === 'main' ? 'Main' : `${f.group} ${f.v.slice(1)}`;
    composer.addShot(shot.png, `${where}: ${shot.note || 'part of the app'}`);
    if (selected !== f) selectFrame(f);
  } catch {
    toast("The frame didn't answer: try again once it has loaded.");
  }
};
stage.addEventListener('pointerup', endSnap, true);
stage.addEventListener('pointercancel', endSnap, true);
function drawSnap() {
  const { s } = snap;
  snapBox.hidden = false;
  snapBox.style.cssText = `left:${Math.min(snap.x0, snap.x1) - s.left}px;top:${Math.min(snap.y0, snap.y1) - s.top}px;width:${Math.abs(snap.x1 - snap.x0)}px;height:${Math.abs(snap.y1 - snap.y0)}px`;
}

panels = mountPanels({
  key: KEY, data: CFG.data, W, screens: SCREENS, playgrounds, frames, ask, send, toast,
  target: () => selected, showVersion, notes: () => notes,
  properties, show: (on) => showSide('right', on), shown: () => sides.right,
});
// Inspect's own button would sit in the header: the frame toolbar has it.
new MutationObserver(() => drawTools()).observe(document.querySelector('.pg-inspect-btn'), { attributes: true, attributeFilter: ['aria-pressed'] });
addEventListener('keydown', (e) => {
  if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); panels.toggle(); }
});
commit = await mountCommit({
  data: DATA, button: document.getElementById('btn-commit'), toast,
  changed: () => { for (const f of frames) if (f.kind === 'exp') drawFoot(f); },
  done: () => location.reload(),
});
panels.start();
xray = mountXray({
  stage, frames, W, ask, toast,
  shield: (on) => { shield.hidden = !on && !snapping && !space && !pan; },
  changed: () => drawTools(),
});

// Properties: what the selected frame is.
function properties(f) {
  if (!f) return '<p class="cv-pnone">Select a frame.</p>';
  const row = (icon, label, value, extra = '') => `<div class="cv-prow">${icon}<span class="cv-plabel">${esc(label)}</span><span class="cv-pval${extra}">${value}</span></div>`;
  const when = (d) => (d ? new Date(`${d}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const screen = f.route?.screen ?? f.screen;
  if (f.kind === 'main') {
    return `<h3>${ICON.main} Main</h3><section>
      ${row(ICON.folder, 'Screen', esc(f.where || SCREENS[screen]?.title || screen))}
      ${row(ICON.clock, 'Runs', "the app as it is")}</section>`;
  }
  const it = iterOf(f), fz = frozen[`${f.pg.id}/${f.v}`];
  const runs = f.onMain || !fz ? "On today's main" : fz.label === 'today' ? "On today's main (git has no older one)" : `On main of ${when((fz.base || fz.date)?.slice(0, 10))}`;
  const picked = commit?.picked(f.pg.id) === f.v;
  const status = it.merged ? `<span class="cv-ok">Merged ${esc(it.merged)}</span>` : picked ? '<span class="cv-on">Picked for main</span>' : 'Not picked';
  return `<h3>${ICON.branch} ${esc(f.group)} ${f.major}</h3>
    <section>
      ${row(ICON.folder, 'Screen', esc(SCREENS[f.pg.screen]?.title || f.pg.screen))}
      ${row(ICON.branch, 'Exploration', `${f.major} · ${esc(f.title)}`)}
      ${row(ICON.pick, 'Iteration', `${esc(f.v.slice(1))} · ${esc(it.name)}`)}
      ${it.from ? row(ICON.branch, 'From', esc(it.from.slice(1))) : ''}
      ${row(ICON.frozen, 'Runs', esc(runs))}
      ${row(ICON.clock, 'Made', esc(when(it.date)))}
    </section>
    <section>${row(ICON.pick, 'Main', status)}</section>
    ${it.note ? `<p class="cv-pnote" title="Click to read it all" onclick="this.classList.toggle('open')">${esc(it.note)}</p>` : ''}`;
}

drawTarget();
