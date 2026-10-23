// The playground page around the project's app (playground/README.md). Part
// of the prototype-playground kit: the same in every project. What's
// particular to this one is in playground/playground.json.
//
// It keeps the explorations, the picks and the version being tried, and works
// out which versions run. The app runs in a frame (started by serve.py on its
// own port) and is told over postMessage which versions to lay over its
// screens (PROTOCOL.md in the skill has the messages; the app's bridge
// answers them). Because every version is compiled into the app, switching is
// instant and keeps the app's state.
//
// <data>/index.json lists the explorations as <screen>/<exploration>; each
// has a versions.json. <data>/picks.json says which version of each runs;
// "default", or none, runs the app's own screen. <data> is "data" in
// playground.json.

import { mountPlayground } from './playground.js';

const load = (path, base = DATA) => {
  const url = new URL(path, base);
  return fetch(url, { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load ${url.pathname} (${r.status})`);
    return r.json();
  });
};
const loadOptional = (path, base, fallback) => load(path, base).catch(() => fallback);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  drop: (k) => { try { localStorage.removeItem(k); } catch {} },
};
const CFG = await load('../playground.json', import.meta.url);
const NAME = CFG.name || 'Prototype';
const KEY = CFG.key || NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const DATA = new URL(`/${CFG.data}/`, location.href);
const PICKS_KEY = `${KEY}.playground.picks`;
const SIZE_KEY = `${KEY}.playground.size`;
const SIZES = CFG.sizes?.length ? CFG.sizes : ['1280x800', '1440x900', '1920x1080'];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const loadPlaygrounds = async () => {
  const { playgrounds = [] } = await loadOptional('index.json', DATA, {});
  const out = await Promise.all(playgrounds.map(async (id) => {
    try {
      const pg = await load(`${id}/versions.json`);
      return { ...pg, id, screen: id.split('/')[0], versions: pg.versions.map((v) => ({ ...v, note: v.note || '' })) };
    } catch (e) {
      console.warn(e);
      return null;
    }
  }));
  return out.filter(Boolean);
};

const [{ screens: SCREENS }, playgrounds, teamPicks] = await Promise.all([
  load('screens.json'), loadPlaygrounds(), loadOptional('picks.json', DATA, {}),
]);
const urlParams = new URLSearchParams(location.search);
// Picks saved in this browser stand in for picks.json when the server can't write it.
let localPicks = store.get(PICKS_KEY, null);
let picks = { ...teamPicks, ...localPicks };
// The version being tried, { playground, version }, until it's picked or put back.
let preview = urlParams.get('playground') && urlParams.get('v')
  ? { playground: urlParams.get('playground'), version: urlParams.get('v') } : null;
let registry = {}; // version id → the pages it changes, from the app's hello
let booted = false;
let route = { screen: Object.keys(SCREENS)[0], params: {} };

const versionOf = (pg) => (preview?.playground === pg.id ? preview.version : picks[pg.id]) || 'default';
const running = () => playgrounds.map((pg) => [pg, versionOf(pg)]).filter(([, v]) => v !== 'default');
const touches = (pg, v) => registry[`${pg.id}/${v}`] || [pg.screen];
const onPlayground = (pg, screen) => screen === pg.start || screen === pg.screen || pg.versions.some((v) => v.id !== 'default' && touches(pg, v.id).includes(screen));
// The app may name what's on show itself (`title` in its where message);
// otherwise it's the screen's title and its parameters' values.
const titleOf = (r) => {
  if (r.title) return r.title;
  const t = SCREENS[r.screen]?.title || r.screen;
  const p = Object.values(r.params || {}).filter((v) => typeof v === 'string' || typeof v === 'number');
  return [t, ...p].join(' · ');
};

document.title = `${NAME} Playground`;
document.getElementById('name').textContent = `${NAME} · Playground`;

// ---- The toast ------------------------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer;
const toast = (text) => {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
};

// ---- The app's frame --------------------------------------------------------------
const frame = document.getElementById('app');
const bootEl = document.getElementById('booting');
const statusEl = document.getElementById('app-status');
const errorsEl = document.getElementById('errors');
const errorsBtn = document.getElementById('btn-errors');
let appPort = null, appHost = '127.0.0.1', appPath = '/', appState = null;
const appOrigin = () => `http://${appHost}:${appPort}`;
frame.title = NAME;
const send = (m) => { if (appPort) frame.contentWindow?.postMessage(JSON.stringify(m), appOrigin()); };

const setStatus = (state, text) => { statusEl.dataset.state = state; statusEl.textContent = text; };
const showErrors = (result) => {
  const has = result && !result.ok && result.errors?.length;
  errorsBtn.hidden = !has;
  if (!has) { errorsEl.hidden = true; errorsBtn.setAttribute('aria-expanded', 'false'); errorsBtn.textContent = 'Show errors'; return; }
  errorsEl.innerHTML = `<p>${esc(result.message)}</p><pre>${esc(result.errors.join('\n'))}</pre>`;
};
errorsBtn.addEventListener('click', () => {
  errorsEl.hidden = !errorsEl.hidden;
  errorsBtn.setAttribute('aria-expanded', String(!errorsEl.hidden));
  errorsBtn.textContent = errorsEl.hidden ? 'Show errors' : 'Hide errors';
});
const boot = (title, text, log, failed = false) => {
  bootEl.hidden = false;
  bootEl.classList.toggle('failed', failed);
  bootEl.querySelector('h2').textContent = title;
  bootEl.querySelector('p').textContent = text;
  const pre = bootEl.querySelector('pre');
  pre.hidden = !log?.length;
  pre.textContent = (log || []).slice(-14).join('\n');
};

// serve.py runs the app; the frame opens it once it's served. The page keeps
// asking how the app is, so the bar shows it if the app stops.
const watchApp = async () => {
  const s = await fetch('/playground/app', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!s) {
    appState = 'none';
    setStatus('error', 'No app: this page needs playground/serve.py');
    if (!booted) boot('The app needs the playground server', `This page is served by another server. Run python3 playground/serve.py at the top of the project (or double-click Open playground.command in playground/), then open http://localhost:${CFG.port || 8820}.`, null, true);
    return;
  }
  appPort = s.port;
  appHost = s.host || appHost;
  appPath = s.path || appPath;
  document.getElementById('open-alone').href = `${appOrigin()}${appPath}`;
  appState = s.state;
  if (s.state === 'starting') {
    setStatus('busy', 'Building the app…');
    boot('Starting the app', s.starting || 'The app is starting.', s.log);
  } else if (s.state === 'stopped' || s.state === 'off') {
    setStatus('error', 'The app stopped');
    boot("The app isn't running", s.state === 'off' ? 'serve.py has nothing to start it with. Its last lines are below.' : "The app stopped. Its last lines are below; fix the cause and start playground/serve.py again.", s.log, true);
  } else {
    if (!frame.src) reloadFrame();
    if (!booted) {
      setStatus('busy', 'Loading the app…');
      boot('Loading the app', s.kind === 'flutter' ? 'The debug build loads its code in pieces, so it takes half a minute or so.' : 'Waiting for the app to say hello to the playground.', null);
    } else if (statusEl.dataset.state === 'busy' && s.state === 'ready' && !reloading) {
      setStatus('ready', 'App ready');
    }
  }
};
watchApp();
setInterval(() => { if (!document.hidden) watchApp(); }, 2500);

// The app, told where the playground is so its bridge answers it.
const appUrl = () => {
  const u = new URL(appPath, appOrigin());
  u.searchParams.set('playground', location.origin);
  return u.href;
};
// A web app reads its registry (the versions compiled in) when it loads, so a
// new or removed version needs the frame loaded again. The page keeps the
// registry the frame loaded and compares it after every reload, whoever asked
// for it (the bar, or a chat's reload.py). A Flutter app's hot reload reads
// the new registry itself.
const REGISTRY = CFG.adapter === 'flutter' ? null : new URL(CFG.web?.registry || 'registry.js', DATA);
const registryNow = () => (REGISTRY ? fetch(REGISTRY, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null)).catch(() => null) : Promise.resolve(null));
let loadedRegistry = null;
// Loads the app again. It says hello when it's back, and is sent the versions
// and the screen again. The promise settles then (or after 15 s), so what comes
// next sees the app's new registry.
let helloWaiters = [];
const reloadFrame = async () => {
  loadedRegistry = await registryNow();
  const back = new Promise((ok) => { helloWaiters.push(ok); setTimeout(ok, 15000); });
  frame.src = appUrl();
  return back;
};
// The versions the app said didn't load, at its last hello.
let loadErrors = [];
const showLoadErrors = () => {
  if (!loadErrors.length) return;
  setStatus('error', `${loadErrors.length === 1 ? 'A version' : `${loadErrors.length} versions`} didn't load`);
  // A reload's own errors (with their files and lines) say more: keep them.
  if (errorsBtn.hidden) showErrors({ ok: false, message: "These versions didn't load, so they don't run. The app and the other versions do.", errors: loadErrors });
};

let reloading = false;
const appReload = async (restart = false) => {
  reloading = true;
  setStatus('busy', restart ? 'Restarting the app…' : 'Reloading the app…');
  const result = await fetch('/playground/app/reload', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'reload' }, body: JSON.stringify({ restart }),
  }).then((r) => r.json()).catch(() => ({ ok: false, message: 'Lost the connection to serve.py.', errors: [] }));
  reloading = false;
  if (result.frame === 'reload' || (REGISTRY && (await registryNow()) !== loadedRegistry)) await reloadFrame();
  setStatus(result.ok ? 'ready' : 'error', result.ok ? `App ready · ${restart ? 'restarted' : 'reloaded'} ${result.at || ''}`.trim() : result.message);
  showErrors(result);
  if (result.ok) showLoadErrors();
  return result;
};
document.getElementById('btn-reload').addEventListener('click', async () => {
  await refresh({ reload: true });
});
document.getElementById('btn-reset').addEventListener('click', async () => {
  const r = await appReload(true);
  if (r.ok) toast('The app started again, with every value back to its start.');
});

// The versions to run, in index.json order.
const sendLayers = () => send({ type: 'layers', layers: running().map(([pg, v]) => `${pg.id}/${v}`) });
// Says when two running versions change the same page: the later one in
// index.json is laid over the earlier one's.
const warnClashes = () => {
  const by = {};
  for (const [pg, v] of running()) {
    if (!registry[`${pg.id}/${v}`]) continue;
    for (const s of touches(pg, v)) (by[s] ??= []).push(`${pg.title} (${pg.versions.find((x) => x.id === v)?.name ?? v})`);
  }
  const clash = Object.entries(by).find(([, list]) => list.length > 1);
  if (clash) {
    const [first, ...rest] = clash[1], last = rest.at(-1);
    toast(`${first}${rest.length > 1 ? ', ' + rest.slice(0, -1).join(', ') : ''} and ${last} both change ${SCREENS[clash[0]]?.title || clash[0]}. ${last} is laid over: where it redraws the whole page, only it shows.`);
  }
};
const notBuilt = () => {
  const [pg, v] = running().find(([p, x]) => !registry[`${p.id}/${x}`]) || [];
  if (pg && booted) toast(`${pg.title} ${v} isn't in the app yet: press Reload app.`);
};
const switchVersions = (pg) => {
  sendLayers();
  if (pg && !onPlayground(pg, route.screen)) send({ type: 'show', screen: pg.start || pg.screen });
  warnClashes();
  notBuilt();
};

// Reads the explorations from disk again (after chat, or anyone, changed
// them), hot-reloads the app if asked, and sends the versions again.
const refresh = async ({ reload = true } = {}) => {
  const fresh = await loadPlaygrounds();
  playgrounds.splice(0, playgrounds.length, ...fresh);
  const result = reload ? await appReload(false) : null;
  // A chat's reload.py has reloaded the app already. An app whose server
  // doesn't reload changed files itself ("hot": false) still needs its frame
  // loaded again to run them.
  if (!reload && CFG.app?.hot === false) await reloadFrame();
  sendLayers();
  panel.redraw();
  return result;
};

// ---- Messages from the app ------------------------------------------------------
const pendingShots = new Map();
const jump = document.getElementById('jump');
jump.innerHTML = Object.entries(SCREENS).map(([id, s]) => `<option value="${esc(id)}">${esc(s.title)}</option>`).join('');
jump.addEventListener('change', () => send({ type: 'show', screen: jump.value }));
addEventListener('message', (e) => {
  if (!appPort || e.source !== frame.contentWindow || e.origin !== appOrigin()) return;
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  if (m.type === 'hello') {
    registry = m.versions || {};
    const first = !booted;
    booted = true;
    bootEl.hidden = true;
    frame.classList.remove('waiting');
    loadErrors = m.errors || [];
    if (loadErrors.length) showLoadErrors();
    else if (statusEl.dataset.state !== 'error') setStatus('ready', 'App ready');
    sendLayers();
    if (first) {
      // Open on the screen in the address (#/settings), or a linked version's start.
      const hash = location.hash.match(/^#\/([\w-]+)/)?.[1];
      const pg = preview && playgrounds.find((p) => p.id === preview.playground);
      const start = hash && SCREENS[hash] ? hash : pg ? pg.start || pg.screen : null;
      if (start && start !== route.screen) send({ type: 'show', screen: start });
      warnClashes();
    } else if (route.screen) {
      // A restart starts the app on its first screen: go back to the one you were on.
      send({ type: 'show', screen: route.screen });
    }
    panel.redraw();
    for (const ok of helloWaiters.splice(0)) ok();
  } else if (m.type === 'where') {
    route = { screen: m.screen, params: m.params || {}, title: m.title };
    document.getElementById('screen-title').textContent = titleOf(route);
    jump.value = route.screen;
    history.replaceState(null, '', `${location.search}#/${route.screen}`);
    panel.update(route);
  } else if (m.type === 'errors') {
    setStatus('error', 'A version stopped with an error');
    showErrors({ ok: false, message: 'A version stopped with an error, so the screen under it is shown instead.', errors: m.errors || [] });
  } else if (m.type === 'captured' || m.type === 'inspected') {
    pendingShots.get(m.id)?.(m);
  } else if (m.type === 'wheel') {
    // A pinch or ⌘-scroll over the app: x and y are in the app's pixels.
    const fb = frame.getBoundingClientRect();
    wheel(m.dx, m.dy, true, fb.left + m.x * viewScale, fb.top + m.y * viewScale);
  } else if (m.type === 'zoomkey') {
    zoomKey(m.key);
  } else if (m.type === 'key' && m.key === 'Space') {
    space(m.down);
  } else if (m.type === 'key') {
    panel.forward.key(m.key, m.down);
  } else if (m.type === 'paste') {
    panel.forward.paste(m.text, m.images);
  } else if (m.type === 'pastekey') {
    panel.forward.pasteKey();
  }
});

// ---- The canvas -------------------------------------------------------------------
// The app sits on a canvas that runs under both panels, like a frame on a
// Figma canvas. It opens at 100%, centred in the space between the panels,
// and stays centred there (following the panels as they open and close) until
// you pan or zoom it yourself; Fit and 100% centre it again.
//   zoom   ⌘+ / ⌘− / ⌘0 (100%) / ⇧1 (fit), pinch or ⌘-scroll, the zoom pill
//   pan    scroll or drag the canvas around the app; hold Space and drag anywhere
// The window size (the header's picker) is the size of the app's window on
// the canvas, as on a desktop. The view is kept in this browser.
const stage = document.getElementById('stage');
const board = document.getElementById('board');
const win = document.getElementById('window');
const sizeSel = document.getElementById('size');
const zoomLabel = document.querySelector('[data-zoom=actual]');
const VIEW_KEY = `${KEY}.playground.view`;
const view = { z: 1, x: 0, y: 0, auto: true, ...store.get(VIEW_KEY, {}) };
sizeSel.innerHTML = SIZES.map((s) => `<option value="${esc(s)}">${esc(s.replace('x', ' × '))}</option>`).join('');
sizeSel.value = store.get(SIZE_KEY, CFG.size || SIZES[0]);
if (!sizeSel.value) sizeSel.value = CFG.size || SIZES[0];
let viewScale = view.z;
const ZMIN = 0.1, ZMAX = 4;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const windowSize = () => sizeSel.value.split('x').map(Number);
// The part of the canvas between the open panels, in the canvas's own pixels,
// with room at the foot for the zoom pill. At phone width the panels float
// over everything, so it's the whole canvas.
const between = () => {
  const sb = stage.getBoundingClientRect();
  let l = 0, r = sb.width;
  if (!matchMedia('(max-width: 760px)').matches) {
    const files = document.getElementById('explorations')?.getBoundingClientRect();
    const chat = document.getElementById('claude')?.getBoundingClientRect();
    if (files) l = Math.max(l, files.right - sb.left);
    if (chat) r = Math.min(r, chat.left - sb.left);
  }
  return { l: l + 16, r: r - 16, t: 16, b: sb.height - 64 };
};
const draw = (glide = false) => {
  board.classList.toggle('glide', glide && !still());
  board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
  // The canvas's dots move and grow with it.
  const dot = 24 * Math.max(0.5, Math.min(2, view.z));
  stage.style.setProperty('--dot', `${dot}px`);
  stage.style.setProperty('--dot-x', `${view.x}px`);
  stage.style.setProperty('--dot-y', `${view.y}px`);
  const b = between();
  stage.style.setProperty('--mid', `${(b.l + b.r) / 2}px`);
  zoomLabel.textContent = `${Math.round(view.z * 100)}%`;
  viewScale = view.z;
  win.style.setProperty('--inv', String(1 / view.z)); // keeps note pins one size at any zoom
  store.set(VIEW_KEY, view);
};
const centre = (glide = false) => {
  const [w, h] = windowSize(), b = between();
  view.x = Math.round((b.l + b.r) / 2 - (w * view.z) / 2);
  view.y = Math.round(Math.max(b.t, (b.t + b.b) / 2 - (h * view.z) / 2));
  view.auto = true;
  draw(glide);
};
const fitZoom = () => {
  const [w, h] = windowSize(), b = between();
  return Math.max(ZMIN, Math.min(1, (b.r - b.l) / w, (b.b - b.t) / h));
};
// Zoom by factor f around the point (px, py) of the canvas.
const zoomAt = (f, px, py, glide = false) => {
  const z = Math.min(ZMAX, Math.max(ZMIN, view.z * f));
  view.x = px - ((px - view.x) * z) / view.z;
  view.y = py - ((py - view.y) * z) / view.z;
  view.z = z;
  view.auto = false;
  draw(glide);
};
const zoomStep = (dir) => {
  const steps = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];
  const next = dir > 0 ? steps.find((s) => s > view.z + 0.001) ?? ZMAX : [...steps].reverse().find((s) => s < view.z - 0.001) ?? ZMIN;
  const b = between();
  if (view.auto) { view.z = next; centre(true); return; }
  zoomAt(next / view.z, (b.l + b.r) / 2, (b.t + b.b) / 2, true);
};
const actual = () => { view.z = 1; centre(true); };
const fitView = () => { view.z = fitZoom(); centre(true); };
const zoomKey = (key) => {
  if (key === 'in') zoomStep(1);
  else if (key === 'out') zoomStep(-1);
  else if (key === 'actual') actual();
  else if (key === 'fit') fitView();
};
document.getElementById('zoom').addEventListener('click', (e) => {
  const b = e.target.closest('[data-zoom]');
  if (b) zoomKey(b.dataset.zoom);
});

const sizeWindow = () => {
  const [w, h] = windowSize();
  Object.assign(win.style, { width: `${w}px`, height: `${h}px` });
};
sizeSel.addEventListener('change', () => { store.set(SIZE_KEY, sizeSel.value); sizeWindow(); if (view.auto) centre(true); });
sizeWindow();
if (view.auto) centre(); else draw();
// While it's centred, it follows the panels (their spring, frame by frame) and the window.
const follow = new ResizeObserver(() => { if (view.auto) centre(); else draw(); });
follow.observe(stage);
const watchPanels = () => {
  for (const id of ['explorations', 'claude']) { const el = document.getElementById(id); if (el) follow.observe(el); }
};

// Scrolling pans; pinch, or ⌘ or Ctrl with the wheel, zooms around the pointer.
const wheel = (dx, dy, zoom, cx, cy) => {
  const sb = stage.getBoundingClientRect();
  if (zoom) zoomAt(Math.exp(-dy * 0.01), cx - sb.left, cy - sb.top);
  else { view.x -= dx; view.y -= dy; view.auto = false; draw(); }
};
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  wheel(e.deltaX, e.deltaY, e.ctrlKey || e.metaKey, e.clientX, e.clientY);
}, { passive: false });

// Dragging the canvas around the app pans it; with Space held, so does a drag
// over the app (a shield covers it, as for a capture).
let pan = null;
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const onApp = e.target.closest('.window') && !e.target.closest('.pg-shield');
  if (onApp || e.target.closest('.zoom') || e.altKey || document.body.classList.contains('pg-aiming')) return;
  e.preventDefault();
  pan = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  stage.setPointerCapture(e.pointerId);
  stage.classList.add('panning');
});
stage.addEventListener('pointermove', (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  view.x = pan.vx + e.clientX - pan.x;
  view.y = pan.vy + e.clientY - pan.y;
  if (Math.abs(e.clientX - pan.x) + Math.abs(e.clientY - pan.y) > 2) view.auto = false;
  draw();
});
const endPan = (e) => {
  if (!pan || e.pointerId !== pan.id) return;
  pan = null;
  stage.classList.remove('panning');
};
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

const typing = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
const space = (down) => document.body.classList.toggle('pg-space', down);
addEventListener('keydown', (e) => {
  const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomKey('in'); }
  else if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomKey('out'); }
  else if (mod && e.key === '0') { e.preventDefault(); zoomKey('actual'); }
  else if (typing(e.target)) return;
  else if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); zoomKey('fit'); }
  else if (e.code === 'Space' && !e.target.closest?.('button, a, summary, [role=button]')) { e.preventDefault(); if (!e.repeat) space(true); }
});
addEventListener('keyup', (e) => { if (e.code === 'Space') space(false); });
addEventListener('blur', () => space(false));

// ---- Capture ----------------------------------------------------------------------
// The app draws its part of the area itself, at twice its real size (it's a
// canvas in a frame, so the page can't redraw it), and names its widgets in
// it. The page redraws anything around the app with modern-screenshot.
const askApp = (rect) => new Promise((ok, fail) => {
  const id = Math.random().toString(36).slice(2);
  const timer = setTimeout(() => { pendingShots.delete(id); fail(new Error('The app took too long to capture.')); }, 15000);
  pendingShots.set(id, (m) => {
    clearTimeout(timer);
    pendingShots.delete(id);
    if (m.error) fail(new Error(m.error)); else ok(m);
  });
  send({ type: 'capture', id, rect, scale: 2 });
});
const pngImage = (b64) => new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = fail; i.src = `data:image/png;base64,${b64}`; });
const capture = async (rect) => {
  const fb = frame.getBoundingClientRect();
  const cut = { x: Math.max(rect.x, fb.left), y: Math.max(rect.y, fb.top), right: Math.min(rect.x + rect.w, fb.right), bottom: Math.min(rect.y + rect.h, fb.bottom) };
  const onApp = cut.right > cut.x && cut.bottom > cut.y && booted;
  const w = where();
  const head = `A capture of the ${w.title} screen (${w.files.join(' + ')})`;
  let shot = null;
  if (onApp) {
    shot = await askApp({ x: (cut.x - fb.left) / viewScale, y: (cut.y - fb.top) / viewScale, w: (cut.right - cut.x) / viewScale, h: (cut.bottom - cut.y) / viewScale });
  }
  const inside = onApp && rect.x >= fb.left - 2 && rect.y >= fb.top - 2 && rect.x + rect.w <= fb.right + 2 && rect.y + rect.h <= fb.bottom + 2;
  let canvas;
  if (inside) {
    const img = await pngImage(shot.png);
    canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
  } else {
    const { domToCanvas } = await import('./vendor/modern-screenshot.mjs');
    const dpr = devicePixelRatio || 1;
    const page = await domToCanvas(document.body, {
      scale: dpr, width: innerWidth, height: innerHeight, style: { margin: '0' },
      filter: (node) => !(node instanceof HTMLIFrameElement),
    });
    canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.w * dpr));
    canvas.height = Math.max(1, Math.round(rect.h * dpr));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(page, rect.x * dpr, rect.y * dpr, rect.w * dpr, rect.h * dpr, 0, 0, canvas.width, canvas.height);
    if (shot) ctx.drawImage(await pngImage(shot.png), (cut.x - rect.x) * dpr, (cut.y - rect.y) * dpr, (cut.right - cut.x) * dpr, (cut.bottom - cut.y) * dpr);
  }
  const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  const note = shot ? `${head}. ${shot.note}` : 'It shows the playground around the app, not the app itself.';
  return { blob, note };
};

// ---- Notes ------------------------------------------------------------------------
// The app names the widget at a point (its type, the file and line that built
// it, and its text), for the Claude panel's notes. Points and boxes go between
// the page's pixels and the app's logical ones.
const askInspect = (x, y) => new Promise((ok, fail) => {
  const id = Math.random().toString(36).slice(2);
  const timer = setTimeout(() => { pendingShots.delete(id); fail(new Error('The app took too long to answer.')); }, 4000);
  pendingShots.set(id, (m) => { clearTimeout(timer); pendingShots.delete(id); ok(m); });
  send({ type: 'inspect', id, x, y });
});
const toApp = (r) => {
  const fb = frame.getBoundingClientRect();
  return [(r.left - fb.left) / viewScale, (r.top - fb.top) / viewScale, r.width / viewScale, r.height / viewScale].map(Math.round);
};
const toClient = ([x, y, w, h]) => {
  const fb = frame.getBoundingClientRect();
  return { left: fb.left + x * viewScale, top: fb.top + y * viewScale, width: w * viewScale, height: h * viewScale,
    right: fb.left + (x + w) * viewScale, bottom: fb.top + (y + h) * viewScale };
};
const inspect = async (cx, cy) => {
  if (!booted) return null;
  const fb = frame.getBoundingClientRect();
  const m = await askInspect((cx - fb.left) / viewScale, (cy - fb.top) / viewScale);
  if (!m.box) return null;
  const area = m.box.map(Math.round);
  return { area, rect: toClient(m.box), widget: m.widget, location: m.location, text: m.text || '' };
};

// ---- The panels -------------------------------------------------------------------
// The page on show, for Claude: its title, parameters and the file(s) it's
// drawn from, from the repo's top: the running versions' folders when they
// change it, else the app's own file.
const where = () => {
  const own = SCREENS[route.screen]?.file;
  const layered = running().filter(([pg, v]) => registry[`${pg.id}/${v}`]?.includes(route.screen)).map(([pg, v]) => `${CFG.data}/${pg.id}/${v}/`);
  return { title: titleOf(route), params: route.params, files: layered.length ? layered : own ? [own] : [] };
};
const savePicks = async (next) => {
  try {
    const r = await fetch('/playground/picks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'picks' }, body: JSON.stringify(next),
    });
    if (!r.ok) throw new Error(r.status);
    Object.assign(teamPicks, next);
    localPicks = null;
    store.drop(PICKS_KEY);
    return 'team';
  } catch {
    localPicks = next;
    store.set(PICKS_KEY, next);
    return 'browser';
  }
};

const panel = mountPlayground({
  name: NAME,
  key: KEY,
  data: CFG.data,
  playgrounds,
  picks: () => picks,
  preview: () => preview,
  local: () => !!localPicks,
  onPlayground,
  // The pages a version changes, from the app's registry, for the graph.
  touches,
  toast,
  open: !!urlParams.get('playground'),
  async tryVersion(pg, version) {
    preview = version === (picks[pg.id] || 'default') ? null : { playground: pg.id, version };
    switchVersions(pg);
  },
  async endPreview() {
    const pg = playgrounds.find((p) => p.id === preview?.playground);
    preview = null;
    switchVersions(pg);
  },
  async use(pg, version) {
    picks = { ...picks, [pg.id]: version };
    preview = null;
    const at = await savePicks(picks);
    switchVersions(pg);
    return at;
  },
  refresh,
  route: () => route,
  where,
  screens: () => Object.entries(SCREENS).map(([id, s]) => ({ id, title: s.title })),
  show(screen) { send({ type: 'show', screen }); },
  async useTeamPicks() {
    localPicks = null;
    store.drop(PICKS_KEY);
    picks = { ...teamPicks };
    preview = null;
    switchVersions();
  },
  capture,
  inspect,
  toApp,
  toClient,
});
panel.update(route);
watchPanels();
if (view.auto) centre();
document.body.classList.add('ready');
