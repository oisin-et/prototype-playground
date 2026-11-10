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
// Frames are live only while they're used: a few at once, the rest show a
// picture (playground/thumbs, or one taken as the frame went to sleep).
// Clicking a frame wakes it and selects it; the selected frame is the one
// Claude will work on (step 6). ⤢ or F opens a frame to fill the window.

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
for (const pg of playgrounds) {
  const byMajor = new Map();
  for (const v of pg.versions) {
    const n = num(v.id);
    if (!n.length) continue;
    if (!byMajor.has(n[0])) byMajor.set(n[0], []);
    byMajor.get(n[0]).push(v);
  }
  const majors = [...byMajor.keys()].sort((a, b) => b - a); // newest first
  for (const major of majors) {
    const iters = byMajor.get(major).sort((a, b) => num(a.id)[1] - num(b.id)[1]);
    const id = `${pg.id}/v${major}`;
    const v = iters.some((x) => x.id === chosen[id]) ? chosen[id] : iters.at(-1).id;
    frames.push({
      id, kind: 'exp', pg, major, iters, v,
      title: iters[0].name, group: pg.title || SCREENS[pg.screen]?.title || pg.id,
      screen: pg.start || pg.screen || pg.on?.[0],
    });
  }
}

// ---- Layout: main on its own row, then a band of rows for each screen ----
const world = document.getElementById('world');
world.style.setProperty('--fw', `${W}px`);
const stage = document.getElementById('stage');
const shield = document.getElementById('shield');
const labels = [];
{
  let y = 0;
  main.x = 0; main.y = y;
  y += H + ROW_GAP;
  let group = null, col = 0;
  for (const f of frames.slice(1)) {
    if (f.group !== group) {
      if (group !== null) y += H + ROW_GAP;
      group = f.group; col = 0;
      labels.push({ text: f.group, x: -GAP, y });
    } else if (col === PER_ROW) {
      col = 0; y += H + ROW_GAP;
    }
    f.x = col * (W + GAP); f.y = y; col++;
  }
}
for (const l of labels) {
  const el = document.createElement('div');
  el.className = 'cv-group';
  el.style.left = `${l.x}px`; el.style.top = `${l.y}px`;
  el.textContent = l.text;
  world.append(el);
}

const iterOf = (f) => f.iters.find((x) => x.id === f.v);
const thumbUrl = (f) => (f.kind === 'main' ? `/playground/thumbs/${playgrounds.find((p) => p.screen === f.screen)?.id || f.screen}/default.png` : `/playground/thumbs/${f.pg.id}/${f.v}.png`);

for (const f of frames) {
  const el = document.createElement('section');
  el.className = `cv-frame ${f.kind}`;
  el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${W}px;height:${H}px`;
  el.dataset.id = f.id;
  el.innerHTML = `
    <header class="cv-head">
      <span class="cv-title"><b>${esc(f.kind === 'main' ? 'Main' : `${f.major}`)}</b> ${esc(f.kind === 'main' ? f.sub : f.title)}</span>
      ${f.iters.length > 1 ? `<span class="cv-steps">
        <button type="button" data-step="-1" aria-label="Earlier iteration">‹</button>
        <select aria-label="Iteration">${f.iters.map((x) => `<option value="${esc(x.id)}">${esc(x.id.slice(1))}${x.merged ? ' ✓' : ''} · ${esc(x.name)}</option>`).join('')}</select>
        <button type="button" data-step="1" aria-label="Later iteration">›</button>
      </span>` : ''}
      ${f.kind === 'exp' ? '<button type="button" class="cv-mode" hidden>Frozen</button>' : ''}
      <button type="button" class="cv-full" title="Fill the window (F)" aria-label="Fill the window">⤢</button>
    </header>
    <div class="cv-body">
      <img class="cv-poster" alt="" draggable="false">
      <div class="cv-empty"><b>${esc(f.kind === 'main' ? 'Main' : f.title)}</b><span>Click to open it live</span></div>
      <div class="cv-cover" title="Click to use it live"></div>
    </div>
    <footer class="cv-foot"></footer>`;
  f.el = el;
  f.body = el.querySelector('.cv-body');
  f.poster = el.querySelector('.cv-poster');
  f.foot = el.querySelector('.cv-foot');
  f.select = el.querySelector('select');
  f.poster.addEventListener('load', () => el.classList.add('has-poster'));
  f.poster.addEventListener('error', () => el.classList.remove('has-poster'));
  if (f.select) {
    f.select.value = f.v;
    f.select.addEventListener('change', () => setIteration(f, f.select.value));
    el.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => step(f, +b.dataset.step)));
  }
  el.querySelector('.cv-mode')?.addEventListener('click', () => toggleMode(f));
  el.querySelector('.cv-full').addEventListener('click', () => { selectFrame(f); focusFrame(f); });
  el.querySelector('.cv-head').addEventListener('pointerdown', () => selectFrame(f));
  world.append(el);
  drawPoster(f);
  drawFoot(f);
}

function drawPoster(f) {
  const shot = f.shots?.[`${f.kind === 'exp' ? sourceOf(f) : 'live'}|${f.v ?? 'main'}`];
  if (shot) f.poster.src = shot;
  else f.poster.src = `${thumbUrl(f)}?t=${Date.now() >> 16}`;
}
function drawFoot(f) {
  if (f.kind === 'main') {
    f.foot.innerHTML = `<span>${esc(f.where || SCREENS[f.screen]?.title || '')}</span>`;
    return;
  }
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
  f.foot.innerHTML = `<span class="cv-iter"><b>${esc(it.id.slice(1))}</b> ${esc(it.name)}</span>${from}${it.merged ? `<span class="cv-merged">✓ in main ${esc(it.merged)}</span>` : ''}${built ? '' : '<span class="cv-warn">not in the app yet: reload it</span>'}<span class="cv-mode-label${f.onMain || !fz ? ' on-main' : ''}">${esc(mode)}</span><span class="cv-date">${esc(it.date || '')}</span>`;
  f.foot.title = it.note || '';
}

// ---- The app: one server for main and the live frames, one for each frozen copy
let app = null; // { origin, path }
const statusEl = document.getElementById('status');
const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.textContent = text; };
const watchApp = async () => {
  const s = await fetch('/playground/app', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!s) { setStatus('error', 'No app: run playground serve.py'); return; }
  if (s.state === 'ready' || s.state === 'waiting') {
    const first = !app;
    app = { origin: `http://${s.host || '127.0.0.1'}:${s.port}`, path: s.path || '/' };
    if (first) {
      await syncFrozen();
      setStatus('ready', 'App ready');
      const sel = frames.find((f) => f.id === store.get(`${KEY}.selected`));
      if (sel) { selectFrame(sel); }
    }
  } else if (s.state === 'starting') setStatus('busy', 'Building the app…');
  else setStatus('error', "The app isn't running");
};

// Frozen copies (frozen.py): every iteration as it was the day it was made.
// An exploration frame shows its frozen copy unless it's switched to "On main"
// (the iteration laid over today's main, as the classic playground does).
let freezing = false;
const post = (url, kind, body = {}) => fetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': kind }, body: JSON.stringify(body),
}).then((r) => r.json()).catch(() => null);
async function syncFrozen() {
  if (freezing) return;
  freezing = true;
  setStatus('busy', 'Freezing new versions…');
  const r = await post('/playground/frozen/sync', 'frozen');
  freezing = false;
  if (!r?.enabled) return;
  const before = Object.keys(frozen).length;
  frozen = r.versions || {};
  for (const f of frames) if (f.kind === 'exp') { drawMode(f); drawFoot(f); }
  const added = Object.keys(frozen).length - before;
  if (before && added > 0) toast(`${added === 1 ? 'A new version is' : `${added} new versions are`} frozen.`);
}
setInterval(() => { if (!document.hidden && app) syncFrozen().then(() => setStatus('ready', 'App ready')); }, 60000);
watchApp();
setInterval(() => { if (!document.hidden) watchApp(); }, 3000);

const send = (f, m) => { if (f.iframe && f.origin) f.iframe.contentWindow?.postMessage(JSON.stringify(m), f.origin); };
const layersOf = (f) => (f.kind === 'main' ? [] : [`${f.pg.id}/${f.v}`]);

const liveOrder = [];
async function wake(f) {
  if (!app) { toast('The app is still starting.'); return; }
  if (f.iframe) { liveOrder.splice(liveOrder.indexOf(f), 1); liveOrder.push(f); return; }
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
const ask = (f, m) => new Promise((ok, fail) => {
  const id = `cv${++askId}`;
  pending.set(id, { ok, fail });
  send(f, { ...m, id });
  setTimeout(() => { if (pending.delete(id)) fail(new Error('No answer')); }, 2500);
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
  } else if (m.type === 'where') {
    f.where = m.title || SCREENS[m.screen]?.title || m.screen;
    if (f.kind === 'main') drawFoot(f);
  } else if (m.type === 'captured') {
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
    else if (m.key === 'Escape' && m.down !== false) escape();
  } else if (m.type === 'zoomkey') {
    zoomKey(m.key);
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
  if (f === selected) drawTarget();
}
// The switch in an exploration's head: its frozen copy, or on today's main.
function drawMode(f) {
  const b = f.el.querySelector('.cv-mode');
  if (!b) return;
  const fz = frozen[`${f.pg.id}/${f.v}`];
  b.hidden = !fz;
  b.textContent = f.onMain ? 'On main' : 'Frozen';
  b.classList.toggle('on-main', !!f.onMain);
  b.title = f.onMain ? "Laid over today's main. Click for the frozen copy." : `As it was ${fz?.date || ''}. Click to lay it over today's main.`;
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
let selected = null;
const targetEl = document.getElementById('target');
function drawTarget() {
  if (!selected) { targetEl.textContent = 'Select a frame'; return; }
  targetEl.innerHTML = selected.kind === 'main'
    ? '▣ <b>Main</b>'
    : `▣ <b>${esc(selected.group)} ${esc(selected.v.slice(1))}</b> ${esc(selected.title)}`;
}
function selectFrame(f) {
  if (selected !== f) {
    selected?.el.classList.remove('selected');
    selected = f;
    f?.el.classList.add('selected');
    store.set(`${KEY}.selected`, f?.id ?? null);
    drawTarget();
  }
  if (f) wake(f);
}

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
  zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(VIEW_KEY, { x: view.x, y: view.y, z: view.z }), 300);
}
function zoomAt(k, px, py, glide = false) {
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
  const xs = frames.map((f) => f.x), ys = frames.map((f) => f.y);
  fitBox(Math.min(...xs) - GAP * 6, Math.min(...ys) - H * 0.25, Math.max(...xs) + W, Math.max(...ys) + H);
};
document.getElementById('btn-fit').addEventListener('click', () => { escape(true); fitAll(); });
if (!store.get(VIEW_KEY, null)) requestAnimationFrame(fitAll); else draw();

// ⤢: the frame fills the window; Esc goes back to where the view was.
let focused = null, beforeFocus = null;
function focusFrame(f) {
  if (!focused) beforeFocus = { ...view };
  focused?.el.classList.remove('focused');
  focused = f;
  f.el.classList.add('focused');
  stage.classList.add('focusing');
  wake(f);
  fitBox(f.x, f.y, f.x + W, f.y + H, 16);
}
function escape(quiet = false) {
  if (focused) {
    focused.el.classList.remove('focused');
    stage.classList.remove('focusing');
    focused = null;
    if (beforeFocus && !quiet) { Object.assign(view, beforeFocus); draw(true); }
    return true;
  }
  return false;
}

stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.004)), e.clientX, e.clientY);
  else { view.x -= e.deltaX; view.y -= e.deltaY; draw(); }
}, { passive: false });

// Drag the background (or anything, with Space held) to pan. While a pan is
// on, the shield keeps the live frames from taking the pointer.
let space = false, pan = null;
function setSpace(down) {
  space = down;
  stage.classList.toggle('grab', down);
  shield.hidden = !down && !pan;
}
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const onCover = e.target.closest('.cv-cover');
  const onBg = e.target === stage || e.target === world || e.target === shield || e.target.classList.contains('cv-group');
  if (!space && !onCover && !onBg) return;
  pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, cover: onCover && !space ? onCover : null };
  shield.hidden = false;
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!pan) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
  if (pan.moved) { view.x = pan.vx + dx; view.y = pan.vy + dy; draw(); }
});
const endPan = () => {
  if (!pan) return;
  if (!pan.moved && pan.cover) selectFrame(frames.find((f) => f.el.contains(pan.cover)));
  else if (!pan.moved && !space) { selected?.el.classList.remove('selected'); selected = null; drawTarget(); }
  pan = null;
  shield.hidden = !space;
};
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

function zoomKey(key) {
  const s = stage.getBoundingClientRect();
  if (key === '+' || key === '=') zoomAt(1.25, s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '-') zoomAt(0.8, s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '0') zoomAt(1 / view.z, s.left + s.width / 2, s.top + s.height / 2, true);
  else if (key === '!' || key === '1') fitAll();
}
const typing = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !typing(e.target)) { e.preventDefault(); if (!space) setSpace(true); return; }
  if ((e.metaKey || e.ctrlKey) && ['+', '=', '-', '0'].includes(e.key)) { e.preventDefault(); zoomKey(e.key); return; }
  if (typing(e.target)) return;
  if (e.shiftKey && (e.key === '!' || e.code === 'Digit1')) { e.preventDefault(); escape(true); fitAll(); }
  else if (e.key === 'Escape') { if (!escape()) { selected?.el.classList.remove('selected'); selected = null; drawTarget(); } }
  else if (selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.iters.length > 1) { e.preventDefault(); step(selected, e.key === 'ArrowLeft' ? -1 : 1); }
  else if (selected && (e.key === 'f' || e.key === 'F')) { focused === selected ? escape() : focusFrame(selected); }
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
addEventListener('resize', () => { if (focused) fitBox(focused.x, focused.y, focused.x + W, focused.y + H, 16); });

drawTarget();
