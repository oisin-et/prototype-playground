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
//   made or touched runs again, whatever it runs on. Main, and any frame on
//   today's main, runs again whenever main changes on disk, however it was
//   changed (the classic playground, a commit, an editor): /playground/main.
// - A sleeping frame shows its own picture (playground/thumbs/_canvas), taken
//   from its frozen copy, which never changes; or none. Never a picture taken
//   of something else. While nobody's using the canvas, frames without one wake
//   one at a time to have theirs taken.
// - Claude is told the page the selected frame shows (its route), not the page
//   it opened on.
//
// Clicking a frame wakes it and selects it; the selected frame is the one
// Claude works on. A frame shows the screen alone; Properties' Hardware (or H)
// shows what's around it. ⤢ or F opens a frame to fill the window between the
// panels; Share's Full view (⇧F) opens it over the panels and everything, full
// screen, the screen 1:1 on a display its size. While a frame fills it, the canvas is locked: it doesn't pan, zoom or fit, no other frame
// can be selected, and only the same button (its icon turned inward), Esc or
// F closes the fill. Inside the
// frame, the app works as ever, and the frame has a zoom of its own: a pinch
// or ⌘-scroll zooms into the app, Space-drag (or a drag or scroll beside it)
// moves around in it, ⇧1 fits it back. The fill stays across a reload.

import { mountComposer } from './composer.js';
import { mountNotes } from './notes.js';
import { mountPanels } from './panels.js';
import { mountCommit } from './commit.js';
import { ICON, TOOL } from './icons.js';
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
let snapping = false, snap = null; // the screenshot (⌥-drag): here, as the toolbar reads it early
let lastInput = 0, filling = null; // posters filled in while idle
let focused = null, beforeFocus = null; // the frame that fills the window, and the view to go back to (focusFrame)
let space = false, pan = null; // Space held; a pan under way (setSpace)
let lens = { z: 1, x: 0, y: 0 }; // the zoom inside the frame that fills the window, in its pixels (lensZoom)
let screenBox = null; // the screen ("preview" in playground.json) in the app's page, in its pixels (see "The screen alone")
let hardware = {}, immerseEl = null, wentFull = false; // frame id → hardware on; Full view's bar; the browser went full screen for it
let immersive = false, filledBefore = false; // Full view (Share) is on; ⤢ was on before it
const NAME = CFG.name || 'Prototype';
const KEY = `${CFG.key || NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.canvas`;
const DATA = new URL(`/${CFG.data}/`, location.href);
const sizeOf = (s) => (typeof s === 'string' ? s : s?.size);
const [W, H] = (sizeOf(CFG.sizes?.find((s) => sizeOf(s) === CFG.size || s?.name === CFG.size)) || sizeOf(CFG.sizes?.[0]) || '1280x800').split('x').map(Number);
const LIVE_MAX = CFG.canvas?.live || 3;
const PER_ROW = CFG.canvas?.perRow || 8;
const GAP = Math.round(W * 0.08);
const ROW_GAP = Math.round(H * 0.45);

document.title = `${NAME} · Canvas`;
document.querySelector('.cv-home-icon').innerHTML = ICON.home;
document.getElementById('btn-share').insertAdjacentHTML('afterbegin', ICON.share);
// Share: a link for the team (not yet), and Full view for the selected frame (or Main).
document.getElementById('btn-share').addEventListener('click', (e) => {
  const b = e.currentTarget.getBoundingClientRect();
  const at = { clientX: b.right - 220, clientY: b.bottom + 4, preventDefault() {}, stopPropagation() { e.stopPropagation(); } };
  const f = selected || main;
  openMenu(at, 'Share', [
    { label: 'Copy link', icon: ICON.external, disabled: true, hint: 'Comes with the team version', run: () => {} },
    { label: `Full view: ${f.kind === 'main' ? 'Main' : frameName(f)}`, icon: ICON.fill, key: '⇧F', run: () => fullView(f) },
  ]);
});

// The panels, the classic playground's: Properties, Files and Library at the
// left (panels.js), Claude at the right, floating over the canvas. Each
// minimises to a strip at its edge (its ‹ or ›, or P for both) and springs
// open again from it, and that's kept for next time. At phone width only one
// is open at a time. Fitting fits between them.
const panelsOpen = { props: true, chat: true, ...store.get(`${KEY}.panels`, {}) };
const panelEl = (which) => document.getElementById(which === 'props' ? 'files' : 'claude');
const narrowView = () => matchMedia('(max-width: 760px)').matches;
function setPanel(which, on) {
  if (on && narrowView()) { const other = which === 'props' ? 'chat' : 'props'; if (panelsOpen[other]) setPanel(other, false); }
  panelsOpen[which] = on;
  const el = panelEl(which);
  el?.classList.toggle('min', !on);
  el?.querySelector('.pg-rail')?.setAttribute('aria-expanded', String(on));
  store.set(`${KEY}.panels`, panelsOpen);
  if (focused) lockTo(focused); // the frame fills the room the panels leave
}

const togglePanels = () => { const on = !panelsOpen.props || !panelsOpen.chat; setPanel('props', on); setPanel('chat', on); };
{
  const chat = panelEl('chat');
  chat.querySelector('.pg-rail').addEventListener('click', () => { setPanel('chat', true); chat.querySelector('textarea')?.focus(); });
  chat.querySelector('[data-close]').addEventListener('click', () => setPanel('chat', false));
}
// The part of the stage the panels and the toolbar leave free (x and y:
// from the stage's left and top).
const TOOLBAND = 60; // the row of round pieces at the top (8 + 44 + 8): the panels start under it
function room() {
  const s = stage.getBoundingClientRect(), y = TOOLBAND;
  if (narrowView()) return { left: s.left, top: s.top + y, width: s.width, height: s.height - y, x: 0, y };
  const w = (which) => (panelsOpen[which] ? panelEl(which)?.querySelector('.pg-body')?.offsetWidth || 320 : 44);
  const l = 8 + w('props') + 8, r = 8 + w('chat') + 8;
  return { left: s.left + l, top: s.top + y, width: Math.max(240, s.width - l - r), height: s.height - y, x: l, y };
}

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
// The explorations on the canvas (serve.py's add_to_canvas), as '<screen>/v<N>',
// and the boards the starting prompts made (see "Boards" below).
const { frames: ON = [], boards: BOARD_IDS = [] } = await loadOptional('../canvas.json', import.meta.url, {});

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

// ---- Boards: what a starting prompt made (composer.js's STARTERS) ---------
// A board is one run's answer to a starting prompt, laid out as a group under
// the frames above, with its title over it: three variants in a row; a flow's
// steps in a row, an arrow from each to the next, and each step's edge cases
// under it; the states side by side; a review's before and after, with what it
// found beside them. Its file is <data>/boards/<id>.json (serve.py's
// add_boards), and canvas.json lists the boards in the order they were made.
// Each item is a frame of its own, on one version ("main" or
// "<screen>/v4.2"), opened on its screen. A variant is an exploration to carry
// on, so it keeps its iterations behind the stepper; every other item shows
// the one version it names, always.
const boards = (await Promise.all(BOARD_IDS.map(({ id }) => load(`boards/${id}.json`, DATA)
  .then((b) => ({ ...b, id })).catch(() => null)))).filter((b) => b && Array.isArray(b.items) && b.items.length);
function itemFrame(board, item, id) {
  const ref = String(item?.version || 'main');
  const base = {
    id, board, caption: String(item?.title || ''), note: String(item?.note || ''),
    params: item?.params && typeof item.params === 'object' ? item.params : null,
  };
  if (ref === 'main') {
    return { ...base, kind: 'main', iters: [], v: null, title: base.caption || 'Main', screen: item?.screen || main.screen };
  }
  const cut = ref.lastIndexOf('/'), pgId = ref.slice(0, cut), vid = ref.slice(cut + 1), [major] = num(vid);
  const pg = playgrounds.find((p) => p.id === pgId);
  const all = (pg?.versions || []).filter((v) => num(v.id)[0] === major).sort((a, b) => num(a.id)[1] - num(b.id)[1]);
  if (!pg || !all.some((x) => x.id === vid)) return null; // deleted since
  const free = board.kind === 'variants';
  const iters = free ? all : all.filter((x) => x.id === vid);
  const v = free ? (iters.some((x) => x.id === chosen[id]) ? chosen[id] : iters.at(-1).id) : vid;
  return {
    ...base, kind: 'exp', pg, major, iters, v, fixed: !free,
    title: all[0].name, group: pg.title || SCREENS[pg.screen]?.title || pg.id,
    screen: item?.screen || pg.start || pg.screen || pg.on?.[0],
  };
}
for (const b of boards) {
  b.frames = [];
  b.items.forEach((item, i) => {
    const f = itemFrame(b, item, `${b.id}#${i + 1}`);
    if (!f) return;
    f.cases = [];
    frames.push(f);
    b.frames.push(f);
    if (b.kind !== 'flow') return;
    (Array.isArray(item.cases) ? item.cases : []).forEach((c, j) => {
      const cf = itemFrame(b, c, `${b.id}#${i + 1}.${j + 1}`);
      if (cf) { cf.isCase = true; f.cases.push(cf); frames.push(cf); }
    });
  });
}

// ---- Layout: main first, then each exploration in the order it joined ----
// The boards come under them, one band each, newest last.
const world = document.getElementById('world');
world.style.setProperty('--fw', `${W}px`);
const stage = document.getElementById('stage');
const shield = document.getElementById('shield');
const loose = frames.filter((f) => !f.board);
loose.forEach((f, i) => {
  f.x = (i % PER_ROW) * (W + GAP);
  f.y = Math.floor(i / PER_ROW) * (H + ROW_GAP);
});
const FLOW_GAP = Math.round(W * 0.5); // room for an arrow and its words between two steps
const CASE_GAP = Math.round(H * 0.6); // room for a dashed line between the names
const LABEL_H = Math.round(H * 0.42); // a board's title, over its frames
const extras = []; // what a board draws besides its frames: {x, y, w, h}, for Home's fit
{
  let top = Math.ceil(loose.length / PER_ROW) * (H + ROW_GAP) + Math.round(H * 0.2);
  for (const b of boards) {
    if (!b.frames.length) continue;
    b.x = 0; b.y = top;
    const y0 = top + LABEL_H;
    let bottom = y0 + H;
    if (b.kind === 'flow') {
      const steps = b.frames.filter((f) => !f.isCase);
      steps.forEach((f, i) => {
        f.x = i * (W + FLOW_GAP); f.y = y0;
        f.cases.forEach((c, j) => { c.x = f.x; c.y = y0 + (j + 1) * (H + CASE_GAP); bottom = Math.max(bottom, c.y + H); });
      });
    } else {
      const cells = [...b.frames, ...(b.kind === 'review' && b.findings?.length ? ['findings'] : [])];
      cells.forEach((f, i) => {
        const x = (i % PER_ROW) * (W + GAP), y = y0 + Math.floor(i / PER_ROW) * (H + ROW_GAP);
        if (f === 'findings') b.card = { x, y }; else { f.x = x; f.y = y; }
        bottom = Math.max(bottom, y + H);
      });
    }
    top = bottom + ROW_GAP;
  }
}

const iterOf = (f) => f.iters.find((x) => x.id === f.v);
// The canvas's own pictures (serve.py's save_canvas_thumb): key → when it was taken.
const pictures = await loadOptional('/playground/thumbs?canvas=1', location.href, {});
// A frame's picture: main's, or its frozen copy's. One running on today's main has none kept.
// A board's item has its own: it opens on its own screen and state, not the version's first.
const pictureKey = (f) => (f === main ? 'main' : f.board ? `board/${f.id.replace(/[^\w-]/g, '-')}` : frozenOf(f) ? `${f.pg.id}/${f.v}` : null);
const pictureUrl = (key) => new URL(`thumbs/_canvas/${key}.png?t=${pictures[key]}`, location.href).href;
// Pictures in two sizes (see drawPoster): declared here, as the frames below draw theirs as they're made.
const SMALL = 320; // the small picture's width
const PICTURE_W = Math.min(W, CFG.canvas?.pictureWidth || 1600); // the full one's
const sets = new Map(); // picture id → { large, small (a promise), own: [blob URLs] }
let shotCount = 0;

for (const f of frames) {
  const el = document.createElement('section');
  el.className = `cv-frame ${f.kind}${f.board ? ' on-board' : ''}${f.isCase ? ' case' : ''}`;
  el.style.cssText = `left:${f.x}px;top:${f.y}px;width:${W}px;height:${H}px`;
  el.dataset.id = f.id;
  el.innerHTML = `
    <header class="cv-head">
      <span class="cv-title">${f.kind === 'main' ? ICON.main : ICON.branch}<b>${esc(f.caption || (f.kind === 'main' ? 'Main' : `${f.group} ${f.major}`))}</b></span>
      ${f.kind === 'exp' && !f.fixed ? `<label class="cv-iter-pick"><span class="cv-iter-now"></span>${ICON.chevron}
        <select aria-label="Iteration">${f.iters.map((x) => `<option value="${esc(x.id)}">${esc(x.id.slice(1))}${x.merged ? ' ✓' : ''} · ${esc(x.name)}</option>`).join('')}</select></label>` : `<span class="cv-iter-now main"></span>`}
      <button type="button" class="cv-fill cv-icon"></button>
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
  el.querySelector('.cv-head').addEventListener('pointerdown', (e) => { if (!menuClick(e)) selectFrame(f); });
  el.querySelector('.cv-head').addEventListener('click', (e) => { if (menuClick(e)) frameMenu(f, e); });
  el.querySelector('.cv-head').addEventListener('contextmenu', (e) => { e.preventDefault(); frameMenu(f, e); });
  el.querySelector('.cv-fill').addEventListener('pointerdown', (e) => e.stopPropagation());
  el.querySelector('.cv-fill').addEventListener('click', (e) => { e.stopPropagation(); if (focused === f) unfocus(); else { selectFrame(f); focusFrame(f); } });
  world.append(el);
  drawPoster(f);
  drawFoot(f);
}
drawBoards();

// Each board's title, its flow's arrows, and its review's findings.
function drawBoards() {
  const NS = 'http://www.w3.org/2000/svg';
  for (const b of boards) {
    if (!b.frames.length) continue;
    const label = document.createElement('div');
    label.className = `cv-board-label ${esc(b.kind)}`;
    label.style.cssText = `left:${b.x}px;top:${b.y + LABEL_H}px`; // its bottom sits over the frames' names (canvas.css)
    const KIND = { variants: 'Variants', flow: 'Flow', states: 'States', review: 'Review' };
    label.innerHTML = `<span class="cv-board-kind">${ICON[b.kind] || ''}${esc(KIND[b.kind] || 'Board')}</span><b>${esc(b.title || '')}</b>`;
    label.title = '⌘-click for its menu; double-click its name to rename it';
    label.querySelector('b').addEventListener('dblclick', (e) => { e.stopPropagation(); renameBoard(b, e.currentTarget); });
    label.addEventListener('pointerdown', (e) => e.stopPropagation());
    label.addEventListener('click', (e) => { if (menuClick(e)) boardMenu(b, e); });
    label.addEventListener('contextmenu', (e) => { e.preventDefault(); boardMenu(b, e); });
    world.append(label);
    if (b.kind === 'flow') {
      const steps = b.frames.filter((f) => !f.isCase);
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'cv-arrows');
      const right = Math.max(...steps.map((f) => f.x + W)), down = Math.max(...b.frames.map((f) => f.y + H));
      svg.setAttribute('width', right); svg.setAttribute('height', down);
      svg.style.cssText = 'left:0;top:0';
      const head = Math.round(W * 0.018);
      let paths = '';
      steps.forEach((f, i) => {
        const next = steps[i + 1];
        if (next) {
          const y = f.y + H / 2, x0 = f.x + W + W * 0.03, x1 = next.x - W * 0.03;
          paths += `<path class="line" d="M${x0} ${y}H${x1 - head * 0.6}"/><path class="head" d="M${x1 - head} ${y - head * 0.7}L${x1} ${y}L${x1 - head} ${y + head * 0.7}z"/>`;
          const words = Array.isArray(b.arrows) ? b.arrows[i] : '';
          if (words) {
            const t = document.createElement('div');
            t.className = 'cv-arrow-label';
            t.textContent = String(words);
            t.style.cssText = `left:${(x0 + x1) / 2}px;top:${y}px;--gap:${x1 - x0}px`;
            world.append(t);
          }
        }
        // Each edge case hangs from its step: a dashed line that stops short of the names (canvas.css).
        f.cases.forEach((c, j) => {
          const link = document.createElement('div');
          link.className = 'cv-case-link';
          link.style.cssText = `left:${f.x + W / 2}px;--top:${(j ? f.cases[j - 1].y : f.y) + H}px;--gap:${CASE_GAP}px`;
          world.append(link);
        });
      });
      svg.innerHTML = paths;
      world.prepend(svg);
    }
    if (b.card) {
      const card = document.createElement('section');
      card.className = 'cv-findings';
      card.style.cssText = `left:${b.card.x}px;top:${b.card.y}px;width:${W}px;height:${H}px`;
      card.innerHTML = `<h4>What the review found</h4><ol>${b.findings.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
      world.append(card);
      extras.push({ x: b.card.x, y: b.card.y, w: W, h: H });
    }
  }
}

// A frame's picture comes in two sizes: a small one for when the frame is
// small on screen or off it, and the full one (the app's own width) for when
// it's big. Which one shows is chosen when the view comes to rest (rest()),
// never while it moves, and the next one is decoded before it's swapped in,
// so a frame never blinks. Pictures taken here are Blobs, not data URLs: their
// URLs are let go when a newer picture replaces them.
// (SMALL, PICTURE_W, sets and shotCount are declared before the frames are made.)
const b64ToBlob = (b64, type = 'image/png') => {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};
// Draws a smaller copy of a picture, as WebP where the browser makes it (PNG otherwise).
async function shrink(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const w = Math.min(SMALL, img.naturalWidth), h = Math.max(1, Math.round(img.naturalHeight * (w / img.naturalWidth)));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/webp', 0.86));
  return blob ? URL.createObjectURL(blob) : src;
}
function pictureSet(id, large, own = []) {
  let s = sets.get(id);
  if (!s) {
    s = { large, own, small: null };
    s.small = shrink(large).then((u) => { if (u !== large) s.own.push(u); return u; }).catch(() => large);
    sets.set(id, s);
  }
  return s;
}
function dropSet(id) {
  const s = sets.get(id);
  if (!s) return;
  sets.delete(id);
  s.small.then(() => { for (const u of s.own) URL.revokeObjectURL(u); });
}
// The picture a frame should show now: its own (taken this session), or the server's.
function pictureOf(f) {
  const shot = f.shots?.[`${f.kind === 'exp' ? sourceOf(f) : 'live'}|${f.v ?? 'main'}`];
  if (shot) return shot;
  const key = pictureKey(f);
  if (key && pictures[key]) {
    const id = `srv:${key}:${pictures[key]}`;
    if (sets.has(id)) return sets.get(id);
    for (const [k, s] of sets) if (k.startsWith(`srv:${key}:`) && s !== f.posterSet) dropSet(k); // an older one of the same
    return pictureSet(id, pictureUrl(key));
  }
  return null;
}
function drawPoster(f) {
  const set = pictureOf(f);
  if (!set) {
    f.posterSet = null;
    f.poster.removeAttribute('src');
    f.el.classList.remove('has-poster');
    return;
  }
  const lod = f.lod || 'small', token = (f.posterToken = (f.posterToken || 0) + 1);
  (lod === 'large' ? Promise.resolve(set.large) : set.small).then(async (src) => {
    if (f.posterToken !== token || f.poster.getAttribute('src') === src) return;
    const next = new Image();
    next.src = src;
    await next.decode().catch(() => {});
    if (f.posterToken !== token) return;
    f.poster.src = src;
    f.posterSet = set;
  });
}
// Keeps a picture this page took: replaces (and lets go of) the one it took before.
function keepShot(f, slot, png) {
  const old = f.shots?.[slot];
  const url = URL.createObjectURL(b64ToBlob(png));
  const id = `shot:${f.id}:${slot}:${++shotCount}`;
  (f.shots ??= {})[slot] = pictureSet(id, url, [url]);
  if (old) for (const [k, s] of sets) if (s === old) dropSet(k);
}
// Forgets what a frame's pictures showed (it changed): they're let go once nothing shows them.
function forgetShots(f) {
  const old = Object.values(f.shots || {});
  f.shots = {};
  for (const [k, s] of sets) if (old.includes(s) && s !== f.posterSet) dropSet(k);
}
// Takes the frame's picture once it has settled: kept for this page, and, for
// main or a frozen copy, on the server for the next time.
async function takePicture(f) {
  const source = f.source, v = f.v ?? 'main', key = pictureKey(f);
  await new Promise((r) => setTimeout(r, 2500));
  if (!f.ready || f.source !== source || (f.v ?? 'main') !== v) return false;
  try {
    const shot = await ask(f, { type: 'capture', width: PICTURE_W }, 12000);
    keepShot(f, `${source}|${v}`, shot.png);
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
      // A dial change on Main made the exploration on show: pick the same part in it.
      const again = store.get(`${KEY}.repick`, null), rf = again && frames.find((f) => f.id === again.id);
      store.set(`${KEY}.repick`, null);
      if (rf) {
        const t0 = Date.now();
        const wait = setInterval(() => {
          if (rf.ready) { clearInterval(wait); setTimeout(() => panels.repick(rf, again), 600); }
          else if (Date.now() - t0 > 20000) clearInterval(wait);
        }, 250);
      }
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
// Main as it is on disk: when it changes, Main and every frame on today's
// main run again (frozen copies don't change).
let mainStamp = null, laterStamp = null; // laterStamp: a change that came while the page was hidden
function mainChanged(stamp) {
  if (!stamp) return;
  if (document.hidden) { laterStamp = stamp; return; }
  if (!app) { mainStamp = stamp; return; }
  if (mainStamp && stamp !== mainStamp) {
    for (const f of frames) if (f.iframe && sourceOf(f) === 'live') { forgetShots(f); rerun(f); }
    toast('Main changed: it runs again.');
  }
  mainStamp = stamp;
}
let pushed = false; // the server tells us (serve.py's /playground/events); without it, we ask every 3 s
try {
  const events = new EventSource('/playground/events');
  events.addEventListener('main', (e) => { pushed = true; try { mainChanged(JSON.parse(e.data).stamp); } catch {} });
  events.onerror = () => { pushed = false; }; // it connects again by itself
} catch {}
document.addEventListener('visibilitychange', () => { if (!document.hidden && laterStamp) { const s = laterStamp; laterStamp = null; mainChanged(s); } });
setInterval(async () => {
  if (pushed || document.hidden || !app) return;
  const r = await fetch('/playground/main', { cache: 'no-store' }).then((x) => x.json()).catch(() => null);
  mainChanged(r?.stamp);
}, 3000);
watchApp();
setInterval(() => { if (!document.hidden) watchApp(); }, 3000);

const send = (f, m) => { if (f.iframe && f.origin) f.iframe.contentWindow?.postMessage(JSON.stringify(m), f.origin); };
// Opens the frame's screen: a board's item, with the params of the state it shows.
const showScreen = (f) => { if (f.screen) send(f, { type: 'show', screen: f.screen, ...(f.params ? { params: f.params } : {}) }); };
const layersOf = (f) => (f.kind === 'main' ? [] : [`${f.pg.id}/${f.v}`]);

const liveOrder = [];
// Where a frame's app runs: the live app, or its frozen copy's own server.
async function frameSrc(f) {
  const source = sourceOf(f);
  let origin = app.origin;
  if (source !== 'live') {
    const r = await post('/playground/frozen/open', 'frozen', { key: source.slice(7) });
    if (!r?.port) { toast(`The frozen copy of ${f.v.slice(1)} isn't there: it runs on today's main.`); f.onMain = true; drawMode(f); }
    else origin = `http://127.0.0.1:${r.port}`;
  }
  const u = new URL(app.path, origin);
  u.searchParams.set('playground', location.origin);
  return { origin, href: u.href, source: sourceOf(f) };
}
const frameTitle = (f) => (f.caption ? `${f.board.title || ''}: ${f.caption}` : f.kind === 'main' ? 'Main' : `${f.group} ${f.major}: ${f.title}`);
async function wake(f) {
  if (!app) { toast('The app is still starting.'); return; }
  f.awaySince = null;
  if (f.iframe) { if (f !== main) { liveOrder.splice(liveOrder.indexOf(f), 1); liveOrder.push(f); } return; }
  const src = await frameSrc(f);
  if (f.iframe) return; // woken twice while waiting
  const iframe = document.createElement('iframe');
  iframe.title = frameTitle(f);
  iframe.src = src.href;
  f.iframe = iframe; f.ready = false; f.origin = src.origin; f.source = src.source;
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
  dropStandby(f);
  if (f.ready && picture) {
    // A picture of it as it was, so the frame looks the same asleep.
    const v = f.v ?? 'main', src = f.source;
    try {
      const shot = await ask(f, { type: 'capture', width: PICTURE_W }, 8000);
      keepShot(f, `${src}|${v}`, shot.png);
    } catch {}
  }
  f.iframe?.remove();
  f.iframe = null; f.ready = false; f.origin = null;
  f.el.classList.remove('live', 'loading');
  drawPoster(f);
}
// Runs the frame again from what it should run now (another frozen copy, or live).
// A live frame that has loaded keeps showing while the new one loads behind
// it, on standby; the two swap once the new one's bridge says hello (see
// promote()), so a change never shows as a blank or a stale picture.
let reloadTimers = new Map();
const STANDBY_MAX_MS = 30000; // a standby that never says hello is given up, and the frame reloads in place
function rerun(f) {
  clearTimeout(reloadTimers.get(f));
  reloadTimers.set(f, setTimeout(async () => {
    if (f.iframe && f.ready && app) { await standby(f); return; }
    f.el.classList.add('loading');
    drawPoster(f);
    const wasLive = !!f.iframe;
    if (wasLive) await sleep(f, false);
    if (wasLive || f === selected || f === focused) wake(f);
  }, 250));
}
async function standby(f) {
  dropStandby(f);
  const src = await frameSrc(f);
  if (!f.iframe) return; // put to sleep meanwhile
  const iframe = document.createElement('iframe');
  iframe.title = frameTitle(f);
  iframe.className = 'cv-standby';
  iframe.tabIndex = -1;
  iframe.src = src.href;
  const timer = setTimeout(() => {
    if (f.next?.iframe !== iframe) return;
    dropStandby(f);
    f.el.classList.add('loading');
    sleep(f, false).then(() => wake(f));
  }, STANDBY_MAX_MS);
  f.next = { iframe, origin: src.origin, source: src.source, timer };
  f.body.insertBefore(iframe, f.iframe); // under the one on show: it loads and draws, out of sight
}
function dropStandby(f) {
  if (!f.next) return;
  clearTimeout(f.next.timer);
  f.next.iframe.remove();
  f.next = null;
}
// The standby has loaded: it becomes the frame's app. The old one stays on top
// a moment longer, while the new one lays its versions over its screen.
const SWAP_MS = 350;
function promote(f) {
  const n = f.next, old = f.iframe;
  clearTimeout(n.timer);
  f.next = null;
  const hadFocus = document.activeElement === old;
  f.iframe = n.iframe; f.origin = n.origin; f.source = n.source; f.ready = false;
  n.iframe.classList.remove('cv-standby');
  n.iframe.removeAttribute('tabindex');
  if (old) {
    old.classList.add('cv-leaving'); // on top, but the pointer goes through to the new one
    setTimeout(() => { old.remove(); if (hadFocus) n.iframe.focus(); }, SWAP_MS);
  }
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
  let f = frames.find((x) => x.iframe && x.iframe.contentWindow === e.source);
  const waiting = !f && frames.find((x) => x.next && x.next.iframe.contentWindow === e.source);
  if (waiting && e.origin === waiting.next.origin) f = waiting; // the standby: it's heard once it says hello
  if (!f || e.origin !== (f === waiting ? f.next.origin : f.origin)) return;
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  if (f === waiting) {
    if (m.type !== 'hello') return;
    promote(f);
  }
  if (m.type === 'hello') {
    f.registry = m.versions || {};
    f.ready = true;
    f.el.classList.remove('loading');
    send(f, { type: 'layers', layers: layersOf(f) });
    measureScreen(f);
    showScreen(f);
    drawFoot(f);
    const key = pictureKey(f);
    if (f.kind === 'main' || (key && (!pictures[key] || f.repicture))) takePicture(f).then((ok) => { if (ok) f.repicture = false; f.pictured?.(ok); });
  } else if (m.type === 'where') {
    f.where = m.title || SCREENS[m.screen]?.title || m.screen;
    f.route = { screen: m.screen, params: m.params || {} };
    if (f.kind === 'main') drawFoot(f);
    notes?.drawPins(f);
    panels?.changed(f);
  } else if (['captured', 'inspected', 'located', 'pictured', 'drawn', 'xrayed', 'restyled', 'designed', 'measured'].includes(m.type)) {
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
    else if (m.key === 'p') togglePanels();
    else if (m.key === 'v') toPointer();
    else if (m.key === 'h') setHardware(f, !hardware[f.id]);
    else if (m.key === 'Mod') holdInspect(m.down);
    else if (m.key === 'ModChord') holdInspect(false);
    else if (m.key === 'Escape' && m.down !== false) {
      if (notes.on) notes.key('Escape'); else if (panels.inspector.on) panels.inspector.set(false); else if (!xray?.escape() && !readerOpen()) closeFill();
    }
  } else if (m.type === 'midpan') {
    midPan(f, m);
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
  if (f.fixed || !f.iters.some((x) => x.id === id) || f.v === id) return;
  f.v = id;
  chosen[f.id] = id;
  store.set(`${KEY}.iteration`, chosen);
  if (f.select) f.select.value = id;
  if (f.iframe && sourceOf(f) !== f.source) rerun(f);
  else if (f.ready) {
    send(f, { type: 'layers', layers: layersOf(f) });
    showScreen(f);
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
  if (f.kind === 'main') return { chip: f.caption || 'Main', page: `Main · ${page.screenTitle}`, kind: 'main', body: { ...page, frame: 'main' } };
  return {
    chip: `${f.group} ${f.v.slice(1)}`, page: `${f.v.slice(1)} · ${iterOf(f)?.name || f.title}`, kind: 'exp',
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

// ---- The toolbar: at the top middle, always there --------------------------
// Its own floating piece, in the panels' colour, for the selected frame: its
// name, then the tools that work on it (Notes, Inspect, X-ray, Screenshot),
// then what it does with the frame (fill the window). With no frame selected
// the tools wait, dimmed. It springs to its new width as its name changes.
const tools = document.getElementById('tools');
const TOOLS = [
  ['pointer', 'Pointer: use the app (V)', TOOL.pointer],
  '|',
  ['inspect', 'Inspect: which component each part is (I, or hold ⌘)', TOOL.inspect],
  ['xray', 'X-ray: drag to see sizes, padding and gaps (or hold ⇧ and drag)', TOOL.xray],
  ['note', 'Notes: click a part to pin a note (N)', TOOL.note],
  ['shot', 'Screenshot: drag over the frame (or hold ⌥ and drag)', TOOL.shot],
];
tools.innerHTML = `<div class="cv-tools-in">${TOOLS.map((t) => (t === '|' ? '<span class="cv-tsep"></span>'
  : `<button type="button" class="cv-icon" data-tool="${t[0]}" title="${esc(t[1])}" aria-label="${esc(t[1])}">${t[2]}</button>`)).join('')}</div>`;
const toolsIn = tools.firstElementChild, toolsFrame = document.getElementById('name'), homeEl = document.getElementById('home');
toolsFrame.textContent = NAME;
tools.addEventListener('pointerdown', (e) => e.stopPropagation());
tools.addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  const f = selected;
  if (!b) return;
  const t = b.dataset.tool;
  if (t === 'pointer') { toPointer(); return; }
  if (!f) return;
  if (t === 'note') notes.set(!notes.on);
  else if (t === 'inspect') panels.inspector.set(!panels.inspector.on);
  else if (t === 'xray') xray.arm(!xray.armed);
  else if (t === 'shot') { aiming = !aiming; setSnap(aiming); }
  drawTools();
});
// Inspect while ⌘ is held (Ctrl off a Mac): on after a moment, so a
// shortcut (⌘C, ⌘V, ⌘+) doesn't flash it; off when ⌘ comes up, unless it
// was on before. A click meanwhile picks the part, as Inspect's click does.
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Meta' : 'Control';
let modTimer = 0, modHeld = false;
function holdInspect(down) {
  clearTimeout(modTimer);
  if (down) {
    if (!panels?.inspector.on) modTimer = setTimeout(() => { modHeld = true; panels.inspector.set(true); drawTools(); }, 160);
    return;
  }
  if (modHeld) { modHeld = false; panels?.inspector.set(false); drawTools(); }
}
addEventListener('keydown', (e) => {
  if (e.key === MOD) { if (!e.repeat && !typing(e.target)) holdInspect(true); }
  else if (e.metaKey || e.ctrlKey) holdInspect(false);
}, true);
addEventListener('keyup', (e) => { if (e.key === MOD) holdInspect(false); }, true);
addEventListener('blur', () => holdInspect(false));
// The pointer: every tool off, back to using the app (the toolbar's first, or V).
function toPointer() {
  if (notes?.on) notes.set(false);
  if (panels?.inspector.on) panels.inspector.set(false);
  if (xray?.armed) xray.arm(false);
  if (aiming) { aiming = false; setSnap(false); }
  drawTools();
}
function drawTools() {
  const f = selected;
  const set = (t, on, title) => {
    const b = tools.querySelector(`[data-tool=${t}]`);
    b.disabled = !f;
    b.setAttribute('aria-pressed', String(!!(f && on)));
    if (title) { b.title = title; b.setAttribute('aria-label', title); }
  };
  set('note', notes?.on);
  const pointer = tools.querySelector('[data-tool=pointer]');
  pointer.setAttribute('aria-pressed', String(!notes?.on && !panels?.inspector.on && !xray?.active && !snapping));
  set('inspect', panels?.inspector.on);
  set('xray', xray?.active); // armed, or ⇧ held
  set('shot', snapping);
  // ⤢ is on each frame, at its top right corner.
  for (const x of frames) {
    const b = x.el.querySelector('.cv-fill'), on = focused === x, icon = on ? ICON.unfill : ICON.fill;
    if (b.innerHTML !== icon) b.innerHTML = icon;
    const t = on ? 'Back to the canvas (Esc)' : 'Fill the window (F)';
    b.title = t; b.setAttribute('aria-label', t); b.setAttribute('aria-pressed', String(on));
  }
  placeFill();
  // Where you are, in Home: the selected frame, else the project.
  const name = f ? (f.kind === 'main' ? 'Main' : `${f.group} ${f.v.slice(1)}`) : NAME;
  if (toolsFrame.textContent !== name) {
    toolsFrame.textContent = name;
    toolsFrame.classList.toggle('main', f?.kind === 'main');
    toolsFrame.classList.toggle('none', !f);
    toolsFrame.title = f ? `You're on ${name}` : 'No frame selected';
    toolsFrame.classList.remove('swap');
    void toolsFrame.offsetWidth;
    toolsFrame.classList.add('swap');
  }
  tools.style.width = `${toolsIn.offsetWidth}px`;
  const was = homeEl.offsetWidth;
  homeEl.style.width = 'auto';
  const w = homeEl.offsetWidth;
  if (w !== was) { homeEl.style.width = `${was}px`; void homeEl.offsetWidth; }
  homeEl.style.width = `${w}px`;
}
let aiming = false; // the toolbar's screenshot: one drag, without ⌥

// ---- The view: pan and zoom --------------------------------------------------
const VIEW_KEY = `${KEY}.view`;
const view = { x: 40, y: 80, z: 0.12, ...store.get(VIEW_KEY, {}) };
const ZMIN = 0.02, ZMAX = 2;
const zoomLabel = document.createElement('span'); // no zoom number on show
let saveTimer = 0;
// The view moves once a frame, however many wheel and pointer events come in
// it: draw() asks for the next frame, paint() moves the world. A glide (a fit,
// a zoom key) paints at once, as its transition starts from there.
//
// While the view moves, the stage is "moving" (and "zooming" while the zoom
// changes): the world is its own layer, live frames don't take the wheel or
// the pointer (a scroll that passes over one keeps moving the canvas), and the
// frames' soft shadows are left out (they'd be drawn again at every step of a
// zoom). What can wait waits for rest(): which frames keep only their names,
// which picture each one shows, and which live frames go to sleep.
const REST_MS = 140; // this long without a move, the view is at rest
let paintAsked = false, glideAsked = false, paintedZ = null, restTimer = 0;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function draw(glide = false) {
  glideAsked ||= glide;
  if (glide) { paint(); return; }
  if (paintAsked) return;
  paintAsked = true;
  requestAnimationFrame(paint);
}
function paint() {
  paintAsked = false;
  const glide = glideAsked && !reduceMotion.matches;
  glideAsked = false;
  world.classList.toggle('glide', glide);
  world.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.z})`;
  const zoomed = view.z !== paintedZ;
  if (zoomed) {
    paintedZ = view.z;
    world.style.setProperty('--inv', String(1 / view.z));
    for (const f of frames) if (f.crop || f === focused) shapeBody(f); // their own --inv
    zoomLabel.textContent = `${Math.round(view.z * (focused ? lens.z : 1) * 100)}%`;
  }
  stir(zoomed, glide ? 480 : REST_MS);
  placeFill();
  notes?.moved();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set(VIEW_KEY, { x: view.x, y: view.y, z: view.z }), 300);
}
// ⤢ for the selected frame, at the top right beside Share, while the
// frame's own (at its top right corner) is out of reach: zoomed in on it,
// or under a panel or the top row. Back in view, only the frame's own shows.
document.getElementById('btn-fill').addEventListener('click', () => { const f = selected; if (!f) return; if (focused === f) unfocus(); else focusFrame(f); });
function placeFill() {
  const f = selected, fillFloat = document.getElementById('btn-fill'); // (paint can run before this part of the file has)
  let show = false;
  if (f && !world.classList.contains('tiny')) {
    const r = room(), s = stage.getBoundingClientRect(), p = onStage(f);
    const top = r.top - s.top, left = r.x, right = r.x + r.width, bottom = top + r.height;
    const seen = p.x < right && p.x + p.w > left && p.y < bottom && p.y + p.h > top;
    const bx = p.x + p.w, by = p.y - 8; // the frame's ⤢: right-aligned over its top edge
    const reach = bx - 36 >= left && bx <= right && by - 36 >= top && by <= bottom;
    show = seen && !reach;
  }
  if (show) {
    const on = focused === f, icon = on ? ICON.unfill : ICON.fill, t = on ? 'Back to the canvas (Esc)' : `Fill the window with ${frameTitle(f)} (F)`;
    if (fillFloat.innerHTML !== icon) fillFloat.innerHTML = icon;
    fillFloat.title = t; fillFloat.setAttribute('aria-label', t);
  }
  if (fillFloat.hidden === !show) return;
  fillFloat.hidden = !show;
}
function stir(zoomed, ms) {
  stage.classList.add('moving');
  if (zoomed) stage.classList.add('zooming');
  clearTimeout(restTimer);
  restTimer = setTimeout(rest, ms);
}
function rest() {
  stage.classList.remove('moving', 'zooming');
  // Small frames keep only their names; tiny ones not even those.
  world.classList.toggle('small', W * view.z < 420);
  world.classList.toggle('tiny', W * view.z < 90);
  choosePictures();
  awayFrames();
}
// Where a frame is on the stage now, in screen pixels (from the stage's left and top).
function onStage(f) {
  const z = view.z;
  return { x: f.x * z + view.x, y: f.y * z + view.y, w: W * z, h: H * z };
}
const inView = (f, margin = 0) => {
  const r = onStage(f), sw = stage.clientWidth, sh = stage.clientHeight;
  return r.x + r.w > -margin && r.y + r.h > -margin && r.x < sw + margin && r.y < sh + margin;
};
// Each frame's picture: the full one when the frame is big on screen, the small one otherwise.
function choosePictures() {
  const dpr = devicePixelRatio || 1;
  for (const f of frames) {
    const lod = inView(f, 200) && W * view.z * (f.crop?.k || 1) * dpr > SMALL * 1.5 ? 'large' : 'small';
    if (lod === f.lod) continue;
    f.lod = lod;
    if (!f.iframe || f.el.classList.contains('loading')) drawPoster(f);
  }
}
// A live exploration that has been out of view, or too small on screen to
// use, for a while goes to sleep (with a picture of itself): only what's in
// use keeps running. Main, the selected frame and the
// one that fills the window stay live. "awayMs": 0 in playground.json's
// "canvas" turns it off.
const AWAY_MS = CFG.canvas?.awayMs ?? 6000;
const USABLE_PX = 240; // narrower than this on screen, a frame can't be used live
function awayFrames() {
  if (!AWAY_MS || focused) return;
  const now = Date.now(), usable = W * view.z >= USABLE_PX;
  for (const f of [...liveOrder]) {
    if (f === selected || f === filling) { f.awaySince = null; continue; }
    if (usable && inView(f)) { f.awaySince = null; continue; }
    f.awaySince ??= now;
    if (now - f.awaySince >= AWAY_MS) { f.awaySince = null; sleep(f); }
  }
}
setInterval(() => { if (!document.hidden && !stage.classList.contains('moving')) awayFrames(); }, 2000);
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
  const s = room();
  const z = Math.min(ZMAX, Math.max(ZMIN, Math.min((s.width - pad * 2) / (x1 - x0), (s.height - pad * 2 - 80) / (y1 - y0))));
  view.z = z;
  view.x = s.x + (s.width - (x1 - x0) * z) / 2 - x0 * z;
  view.y = s.y + (s.height - (y1 - y0) * z) / 2 - y0 * z;
  draw(true);
}
const fitAll = () => {
  if (focused) { resetLens(); return; } // the canvas is locked: the frame fits
  const xs = frames.map((f) => f.x), ys = frames.map((f) => f.y);
  fitBox(Math.min(...xs) - GAP, Math.min(...ys) - H * 0.25, Math.max(...xs, ...extras.map((e) => e.x)) + W + GAP, Math.max(...ys) + H);
};
// Fits one board: the one a run has just made.
const BOARD_KEY = `${KEY}.board`;
function fitBoard(id) {
  const b = boards.find((x) => x.id === id);
  if (!b?.frames.length) return false;
  const xs = b.frames.map((f) => f.x), ys = b.frames.map((f) => f.y);
  fitBox(Math.min(...xs) - GAP, b.y - H * 0.1, Math.max(...xs, ...(b.card ? [b.card.x] : [])) + W + GAP, Math.max(...ys) + H);
  return true;
}
const btnFit = document.getElementById('btn-fit');
btnFit.addEventListener('click', () => { unfocus(); fitAll(); });
// The view is kept, unless the frames have changed since: then all of them.
const LAYOUT_KEY = `${KEY}.layout`, layout = frames.map((f) => f.id).join(' ');
{
  const fresh = store.get(BOARD_KEY, null);
  store.set(BOARD_KEY, null);
  if (fresh && boards.some((b) => b.id === fresh)) requestAnimationFrame(() => fitBoard(fresh));
  else if (!store.get(VIEW_KEY, null) || store.get(LAYOUT_KEY, null) !== layout) requestAnimationFrame(fitAll); else draw();
}
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
  document.body.classList.toggle('cv-immersive', immersive);
  if (immersive) {
    // Full view: the whole window, over the panels. What the frame shows (the
    // screen alone, or the whole app) fills it, so a window the screen's size shows it 1:1.
    const s = stage.getBoundingClientRect(), c = f.crop;
    const bw = c ? screenBox.w * c.k : W, bh = c ? screenBox.h * c.k : H, bx = (W - bw) / 2, by = (H - bh) / 2;
    const z = Math.min(s.width / bw, s.height / bh);
    Object.assign(view, { z, x: (s.width - bw * z) / 2 - (f.x + bx) * z, y: (s.height - bh * z) / 2 - (f.y + by) * z });
  } else {
    // ⤢: the room the panels leave.
    const s = room();
    const z = Math.min(ZMAX, Math.max(ZMIN, Math.min((s.width - 32) / W, (s.height - 32 - 80) / H)));
    Object.assign(view, { z, x: s.x + (s.width - W * z) / 2 - f.x * z, y: s.y + (s.height - H * z) / 2 - f.y * z });
  }
  showImmerse();
  draw(glide);
  clampLens();
  drawLens();
}
const fitTitle = () => {}; // Home always shows every frame

// Inside the frame that fills the window: its own zoom, in the frame's pixels,
// on the layer that holds the app and what's laid over it (notes, X-ray,
// Inspect), so they stay in step. The frame's edge and the canvas don't move.
const LENS_MAX = 4; // up to 400% of the app's own pixels
function drawLens() {
  const f = focused;
  if (!f) return;
  shapeBody(f);
  zoomLabel.textContent = `${Math.round(view.z * lens.z * 100)}%`;
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
// Share's Full view: the frame over the panels and everything, and the
// browser full screen, for a display the screen is tried on. Closing it goes
// back to ⤢ if that was on, else to the canvas.
function fullView(f) {
  if (!f || (focused && f !== focused)) return;
  filledBefore = focused === f;
  selectFrame(f);
  immersive = true;
  focusFrame(f);
  drawTools();
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => { wentFull = true; }).catch(() => {});
}
function leaveFullView() {
  if (!immersive) return false;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  wentFull = false;
  if (filledBefore && focused) { immersive = false; lockTo(focused); drawTools(); }
  else unfocus();
  return true;
}
// Esc, and the bridge's: Full view first, then ⤢.
const closeFill = () => leaveFullView() || unfocus();
function unfocus() {
  if (!focused) return false;
  const was = focused;
  immersive = false;
  focused.el.classList.remove('focused');
  stage.classList.remove('focusing');
  document.body.classList.remove('cv-immersive');
  lens = { z: 1, x: 0, y: 0 };
  focused = null;
  shapeBody(was);
  if (immerseEl) immerseEl.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
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
// The middle button drags the canvas from anywhere on it, as in Figma: over a
// live frame the frame's bridge sends the drag (midPan).
function startPan(x, y, mid) {
  pan = { x, y, vx: view.x, vy: view.y, lx: lens.x, ly: lens.y, moved: false, cover: null, mid };
  shield.hidden = false;
  stage.classList.add('grabbing');
}
function movePan(x, y) {
  if (!pan) return;
  const dx = x - pan.x, dy = y - pan.y;
  if (Math.abs(dx) + Math.abs(dy) > 4) pan.moved = true;
  if (!pan.moved) return;
  if (focused) { const s0 = clipScale(); lens.x = pan.lx + dx / s0; lens.y = pan.ly + dy / s0; clampLens(); drawLens(); } // the canvas is locked
  else { view.x = pan.vx + dx; view.y = pan.vy + dy; draw(); }
}
function midPan(f, m) {
  if (m.phase === 'end') { if (pan?.mid === 'page') endPan(); return; }
  const r = f.iframe.getBoundingClientRect(), k = r.width / (f.iframe.offsetWidth || r.width);
  const x = r.left + m.x * k, y = r.top + m.y * k; // the frame's point, on the canvas
  if (m.phase === 'start') { if (!pan) startPan(x, y, 'page'); }
  else if (pan?.mid === 'page' && !pan.moved) movePan(x, y); // once it moves, the frame moves with it: the shield's points count
}
stage.addEventListener('pointerdown', (e) => {
  if (e.button === 1) {
    if (overCanvas(e)) return;
    e.preventDefault(); // no autoscroll
    startPan(e.clientX, e.clientY, 'stage');
    try { stage.setPointerCapture(e.pointerId); } catch {}
    return;
  }
  if (e.button !== 0 || overCanvas(e)) return;
  const onCover = e.target.closest('.cv-cover');
  const onBg = e.target === stage || e.target === world || e.target === shield;
  if (!space && !onCover && !onBg) return;
  pan = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, lx: lens.x, ly: lens.y, moved: false, cover: onCover && !space ? onCover : null };
  shield.hidden = false;
  try { stage.setPointerCapture(e.pointerId); } catch {}
});
// A drag that started in a frame goes on over the shield.
stage.addEventListener('pointermove', (e) => {
  if (!pan) return;
  if (pan.mid === 'page' && !(e.buttons & 4)) return endPan(); // the button came up out of sight
  movePan(e.clientX, e.clientY);
});
stage.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
const endPan = () => {
  if (!pan) return;
  if (pan.mid) {} // the middle button only moves the canvas
  else if (!pan.moved && pan.cover) selectFrame(frames.find((f) => f.el.contains(pan.cover)));
  else if (!pan.moved && !space && !focused) selectFrame(null);
  pan = null;
  shield.hidden = !space;
  stage.classList.remove('grabbing');
};
stage.addEventListener('pointerup', endPan);
stage.addEventListener('pointercancel', endPan);

function zoomKey(key) {
  const s = room();
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
  else if (e.key === 'Escape') { if (readerOpen()) return; if (!closeFill()) selectFrame(null); }
  else if (selected && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && selected.iters.length > 1) { e.preventDefault(); step(selected, e.key === 'ArrowLeft' ? -1 : 1); }
  else if ((e.key === 'v' || e.key === 'V') && !e.metaKey && !e.ctrlKey && !e.altKey) toPointer();
  else if (selected && e.key === 'F' && e.shiftKey) { immersive ? leaveFullView() : fullView(selected); }
  else if (selected && (e.key === 'f' || e.key === 'F')) { focused === selected ? closeFill() : focusFrame(selected); }
  else if ((focused || selected) && (e.key === 'h' || e.key === 'H') && !e.metaKey && !e.ctrlKey && !e.altKey) { const f = focused || selected; setHardware(f, !hardware[f.id]); }
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

// ---- The screen alone, and the hardware ----------------------------------------
// A frame shows only the screen (the element "preview" in playground.json
// names), cropped from the app's page and filling the frame: what's around
// it, the hardware, is off until the frame's own button (or H) turns it on.
// The bridge says where the screen is (measure); it's kept, so a sleeping
// frame's picture is cropped the same way. Notes, X-ray and Inspect sit in
// the app's pixels inside the lens, so they crop with it.
const HW_KEY = `${KEY}.hardware`, BOX_KEY = `${KEY}.screenBox`;
hardware = store.get(HW_KEY, {});
screenBox = CFG.preview ? store.get(BOX_KEY, null) : null;
function cropOf(f) {
  const r = screenBox;
  if (!r || hardware[f.id]) return null;
  const k = Math.min(W / r.w, H / r.h);
  return { k, x: (W - r.w * k) / 2 - r.x * k, y: (H - r.h * k) / 2 - r.y * k };
}
// The lens's transform: the zoom inside a frame that fills the window, over the crop.
function shapeBody(f) {
  const c = f.crop = cropOf(f), L = focused === f && lens.z !== 1 ? lens : null;
  f.body.style.transform = [L && `translate(${L.x}px, ${L.y}px) scale(${L.z})`, c && `translate(${c.x}px, ${c.y}px) scale(${c.k})`].filter(Boolean).join(' ');
  const z = (L ? L.z : 1) * (c ? c.k : 1);
  if (z === 1) f.body.style.removeProperty('--inv');
  else f.body.style.setProperty('--inv', String(1 / (view.z * z))); // what keeps its size on screen
  f.el.classList.toggle('cropped', !!c);
  if (f === focused) drawImmerse();
}
function setHardware(f, on) {
  if (!CFG.preview) return;
  if (on) hardware[f.id] = true; else delete hardware[f.id];
  store.set(HW_KEY, hardware);
  shapeBody(f);
  if (f === focused) lockTo(f);
  choosePictures();
  notes?.moved();
  panels?.changed(f); // Properties' switch
}
// Properties' Hardware switch.
document.addEventListener('click', (e) => {
  const b = e.target instanceof Element && e.target.closest('[data-hardware]');
  if (b && selected) setHardware(selected, !hardware[selected.id]);
});
async function measureScreen(f) {
  if (!CFG.preview) return;
  try {
    const { rect: r } = await ask(f, { type: 'measure', selector: CFG.preview });
    if (!r || r.w < 8 || r.h < 8) return;
    const q = (v) => Math.round(v * 100) / 100; // fractions kept: ⤢ shows the screen 1:1 on a display its size
    const box = { x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) };
    if (screenBox && ['x', 'y', 'w', 'h'].every((k) => screenBox[k] === box[k])) return;
    screenBox = box;
    store.set(BOX_KEY, box);
    for (const x of frames) shapeBody(x);
    if (focused) lockTo(focused, false);
    notes?.moved();
  } catch {}
}

// ⤢ is immersive: the frame over the panels and everything, full screen. Its
// own small bar (top left) turns the hardware on or off and closes it; it
// fades while it's not used, and comes back when the pointer goes to the
// window's top edge or over it.
immerseEl = document.createElement('div');
immerseEl.className = 'cv-immerse';
immerseEl.hidden = true;
immerseEl.innerHTML = `<div class="cv-immerse-edge"></div><div class="cv-immerse-bar">
  <button type="button" class="cv-float cv-icon" data-hw></button>
  <button type="button" class="cv-float cv-icon" data-exit title="Close (Esc)" aria-label="Close (Esc)">${ICON.unfill}</button></div>`;
document.body.append(immerseEl);
immerseEl.querySelector('[data-hw]').addEventListener('click', () => { if (focused) setHardware(focused, !hardware[focused.id]); });
immerseEl.querySelector('[data-exit]').addEventListener('click', () => leaveFullView());
let immerseTimer = 0;
function showImmerse() {
  if (!immerseEl) return;
  immerseEl.hidden = !immersive;
  immerseEl.classList.remove('idle');
  clearTimeout(immerseTimer);
  immerseTimer = setTimeout(() => { if (!immerseEl.matches(':hover')) immerseEl.classList.add('idle'); }, 2500);
  drawImmerse();
}
function drawImmerse() {
  if (!immerseEl) return;
  const b = immerseEl.querySelector('[data-hw]'), on = !!(focused && hardware[focused.id]);
  if (!CFG.preview) { b.hidden = true; return; }
  const t = on ? 'Hide the hardware: the screen alone (H)' : 'Show the hardware (H)';
  if (!b.innerHTML) b.innerHTML = ICON.hardware; // once: a redraw under the pointer would lose the click
  b.title = t; b.setAttribute('aria-label', t); b.setAttribute('aria-pressed', String(on));
}
immerseEl.addEventListener('pointerenter', () => showImmerse());
immerseEl.addEventListener('pointerleave', () => showImmerse());
addEventListener('pointermove', () => { if (immersive && immerseEl.classList.contains('idle')) showImmerse(); }, { passive: true });
document.addEventListener('fullscreenchange', () => {
  if (document.fullscreenElement) return;
  if (wentFull && immersive) { wentFull = false; leaveFullView(); } // Esc left full screen: leave Full view too
  wentFull = false;
});
for (const f of frames) shapeBody(f);
if (focused) lockTo(focused, false);

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
  changed: () => drawTools(), // the toolbar shows Notes on
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
  const f = frames.find((x) => x.kind === 'exp' && !x.fixed && x.pg.id === pgId && x.major === major);
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

// ---- The ⌘-click menu (or right-click): delete what a frame or board is ----
// On a frame's name: its iteration, or the whole exploration; on a board's
// title: the board. What goes is moved to the trash (serve.py's
// canvas_delete), the canvas lays out again, and a toast offers Undo.
const UNDO_KEY = `${KEY}.undo`;
const menuClick = (e) => e.button === 0 && (e.metaKey || e.ctrlKey);
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }
function openMenu(e, title, items) {
  closeMenu();
  e.preventDefault(); e.stopPropagation();
  menuEl = document.createElement('div');
  menuEl.className = 'cv-menu';
  menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = `<div class="cv-menu-title">${esc(title)}</div>` + items.map((x, i) => (x.note
    ? `<div class="cv-menu-note">${esc(x.note)}</div>`
    : `<button type="button" role="menuitem" class="${x.danger ? 'danger' : ''}" data-i="${i}"${x.disabled ? ' disabled' : ''}${x.hint ? ` title="${esc(x.hint)}"` : ''}>${x.icon || ''}<span>${esc(x.label)}</span>${x.key ? `<kbd>${esc(x.key)}</kbd>` : ''}</button>`)).join('');
  document.body.append(menuEl);
  const w = menuEl.offsetWidth, h = menuEl.offsetHeight;
  menuEl.style.left = `${Math.min(e.clientX, innerWidth - w - 8)}px`;
  menuEl.style.top = `${Math.min(e.clientY + 4, innerHeight - h - 8)}px`;
  menuEl.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  menuEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-i]'); if (b) { const x = items[+b.dataset.i]; closeMenu(); x.run(); } });
  menuEl.querySelector('button')?.focus();
}
addEventListener('pointerdown', () => closeMenu());
addEventListener('keydown', (e) => { if (e.key === 'Escape' && menuEl) { e.stopImmediatePropagation(); closeMenu(); } }, true);
addEventListener('blur', () => closeMenu());
function frameMenu(f, e) {
  if (f.board) { boardMenu(f.board, e); return; }
  if (f.kind === 'main') { openMenu(e, 'Main', [{ note: 'Main is the app itself: it can’t be deleted.' }]); return; }
  const name = `${f.group} ${f.major}`, it = `${f.group} ${f.v.slice(1)}`;
  const items = [];
  if (f.iters.length > 1) items.push({ label: `Delete iteration ${f.v.slice(1)}`, icon: ICON.trash, danger: true, run: () => remove({ what: 'iteration', frame: f.id, version: f.v }, `${it} is deleted.`) });
  items.push({ label: f.iters.length > 1 ? `Delete exploration (${f.iters.length} iterations)` : 'Delete exploration', icon: ICON.trash, danger: true,
    run: () => remove({ what: 'exploration', frame: f.id }, `${name} is deleted.`) });
  openMenu(e, name, items);
}
function boardMenu(b, e) {
  const KIND = { variants: 'Variants', flow: 'Flow', states: 'States', review: 'Review' }[b.kind] || 'Board';
  openMenu(e, `${KIND}: ${b.title || ''}`, [{ label: 'Delete board', icon: ICON.trash, danger: true, run: () => remove({ what: 'board', board: b.id }, `The ${KIND.toLowerCase()} board is deleted.`) }]);
}
// A board's name: double-click it, type, Enter (Esc keeps the old one).
function renameBoard(b, el) {
  if (el.isContentEditable) return;
  const was = b.title || '';
  el.contentEditable = 'plaintext-only';
  el.classList.add('editing');
  el.focus();
  getSelection().selectAllChildren(el);
  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    el.contentEditable = 'false';
    el.classList.remove('editing');
    const title = el.textContent.replace(/\s+/g, ' ').trim();
    if (!keep || !title || title === was) { el.textContent = was; return; }
    const r = await post('/playground/canvas', 'canvas', { what: 'rename', board: b.id, title });
    if (!r || r.error) { el.textContent = was; toast(r?.error || 'The playground isn’t answering.'); return; }
    b.title = el.textContent = r.title;
  };
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  el.addEventListener('blur', () => finish(true), { once: true });
}
async function remove(body, done) {
  const r = await post('/playground/canvas', 'canvas', body);
  if (!r || r.error) { toast(r?.error || 'The playground isn’t answering.'); return; }
  store.set(UNDO_KEY, { text: done, trash: r.trash, canvas: r.canvas });
  location.reload();
}
// After a delete: the toast, with Undo, for 8 seconds.
{
  const u = store.get(UNDO_KEY, null);
  if (u) {
    store.set(UNDO_KEY, null);
    setTimeout(() => {
      toast(u.text);
      clearTimeout(toastTimer);
      toastEl.insertAdjacentHTML('beforeend', ' <button type="button" class="cv-undo">Undo</button>');
      toastEl.querySelector('.cv-undo').addEventListener('click', async () => {
        const r = await post('/playground/canvas', 'canvas', { what: 'restore', trash: u.trash, canvas: u.canvas });
        if (!r || r.error) { toast(r?.error || 'It couldn’t be put back.'); return; }
        store.set(NOTICE_KEY, 'It’s back.');
        location.reload();
      });
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), 8000);
    }, 800);
  }
}

// After a run: the versions it made or changed. A new iteration joins its
// frame; a new exploration needs a place on the canvas, so the page lays out
// again (keeping the view and the selection). Every frame on a version the run
// touched runs again, whatever it runs on, and has its picture taken again.
async function afterRun(result) {
  const made = [...(result.new || []), ...(result.updated || [])];
  if (result.boards?.length) {
    // A starting prompt's board: the canvas lays out again, on it.
    store.set(NOTICE_KEY, `${result.boards.length === 1 ? 'The board is' : `${result.boards.length} boards are`} on the canvas, under the frames.`);
    store.set(BOARD_KEY, result.boards.at(-1));
    toast('The board is ready: laying the canvas out again…');
    setTimeout(() => location.reload(), 1200);
    return;
  }
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
      const f = frames.find((x) => x.kind === 'exp' && !x.fixed && x.pg.id === id && x.major === n[0]);
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
    forgetShots(f);
    f.repicture = true;
    if (f.iframe) rerun(f); else drawPoster(f);
  }
  // The live app compiles its versions in as it loads: main loads again too, and a board's frames on main.
  for (const f of frames) if (f.kind === 'main' && f.iframe) rerun(f);
  if (showVersion(key) !== 'locked') toast(`${first.playground} ${first.version.slice(1)} is ready.`);
}

// ---- Pictures for frames that have none ------------------------------------------
// While nobody's using the canvas, a frame without a picture wakes, has it
// taken, and sleeps again: one at a time, the nearest to the middle first.
// A frozen copy's picture is taken once: the copy never changes.
for (const type of ['pointerdown', 'wheel', 'keydown']) addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
const tried = new Set();
function fillPictures() {
  setInterval(async () => {
    if (filling || focused || document.hidden || !app || Date.now() - lastInput < 4000) return;
    const s = stage.getBoundingClientRect();
    const cx = (s.width / 2 - view.x) / view.z, cy = (s.height / 2 - view.y) / view.z;
    const todo = frames.filter((f) => (f.kind === 'exp' || f.board) && !f.iframe && !tried.has(f.id + f.v)
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
function setSnap(down) {
  if (!down) aiming = false;
  snapping = down || aiming;
  down = snapping;
  document.body.classList.toggle('pg-alt', down);
  stage.classList.toggle('snapping', down || !!snap);
  shield.hidden = !down && !snap && !space && !pan;
  drawTools(); // Screenshot shows on while ⌥ is held
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
  properties, show: (on) => setPanel('props', on), shown: () => panelsOpen.props, select: (f) => selectFrame(f),
  // The dials made a new exploration (a change on Main): open the canvas on it,
  // filling the window if Main did.
  opened: (pg, v, repick) => {
    const id = `${pg}/v${num(v)[0]}`;
    store.set(`${KEY}.repick`, repick ? { id, ...repick } : null);
    chosen[id] = v;
    store.set(`${KEY}.iteration`, chosen);
    store.set(`${KEY}.selected`, id);
    if (focused) store.set(FILL_KEY, { id, before: beforeFocus, lens });
    toast(`${pg} ${v.slice(1)} is a new exploration with your change: opening it…`);
    setTimeout(() => location.reload(), 700);
  },
});
// Both panels as they were left (at phone width, both minimised at first).
setPanel('props', !narrowView() && panelsOpen.props);
setPanel('chat', !narrowView() && panelsOpen.chat);
// Claude's strip keeps a dot while a chat is working.
{
  const dot = panelEl('chat').querySelector('.pg-rail-dot'), chatEl = document.getElementById('composer');
  const drawDot = () => { const n = +(chatEl.dataset.running || 0); dot.hidden = !n; dot.title = n ? (n === 1 ? 'Claude is working' : `${n} chats are working`) : ''; };
  new MutationObserver(drawDot).observe(chatEl, { attributes: true, attributeFilter: ['data-running'] });
  drawDot();
}
// Inspect's own button would sit in the header: the frame toolbar has it.
new MutationObserver(() => drawTools()).observe(document.querySelector('.pg-inspect-btn'), { attributes: true, attributeFilter: ['aria-pressed'] });
addEventListener('keydown', (e) => {
  if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); togglePanels(); }
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
  // The hardware around the screen: off, the frame is the screen alone (H).
  const on = !!hardware[f.id];
  const hwRow = CFG.preview ? `<section><div class="cv-prow">${ICON.hardware}<span class="cv-plabel">Hardware</span><span class="cv-pval">
    <button type="button" class="cv-switch" role="switch" data-hardware aria-checked="${on}" title="${on ? 'Hide the hardware: the screen alone' : 'Show the hardware around the screen'} (H)"><i></i></button>
    <span class="cv-pmuted">${on ? 'Shown' : 'Screen only'}</span></span></div></section>` : '';
  if (f.kind === 'main') {
    return `<h3>${ICON.main} Main</h3><section>
      ${row(ICON.folder, 'Screen', esc(f.where || SCREENS[screen]?.title || screen))}
      ${row(ICON.clock, 'Runs', "the app as it is")}</section>${hwRow}`;
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
    <section>${row(ICON.pick, 'Main', status)}</section>${hwRow}
    ${it.note ? `<p class="cv-pnote" title="Click to read it all" onclick="this.classList.toggle('open')">${esc(it.note)}</p>` : ''}`;
}

drawTarget();
