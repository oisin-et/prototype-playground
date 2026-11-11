// The panel at the canvas's left (src/canvas.js): Properties, Files and
// Library, in the classic playground's panel. It minimises to a strip at the
// edge, named for the pane on show, with a dot while files are changing.
// Part of the prototype-playground kit.
//
// - Properties: what the selected frame is (its screen, exploration and
//   iteration, what it started from, whether it runs frozen or on today's
//   main, and whether it's picked or merged), from hooks.properties(f).
// - Files (files.js) shows "On show" for the selected frame (or the one the
//   frame toolbar's Files opened it for): the file main draws the screen from,
//   the iteration's folder, and its exploration's versions.json. Changed and
//   All files are the project's, as in the classic playground. The reader
//   opens over the canvas.
// - Library (library.js) asks the selected frame's app to point at, picture
//   and draw components.
// - Inspect (inspect.js, I): hover any live frame to see which component each
//   part is; a click picks it. Properties then shows its Design (design.js):
//   each value against the project's design system, with the parts it sits
//   in to step out to. Inspect and note mode turn each other off.

import { FilesView } from './files.js';
import { LibraryView } from './library.js';
import { mountInspect } from './inspect.js';
import { designHTML, loadSystem } from './design.js';

/**
 * o: {
 *   key, data, W, screens, playgrounds, frames,
 *   ask(f, message, wait), send(f, message),
 *   target(): the selected frame,
 *   showVersion('<screen>/<version>'), toast(text), notes(): the notes (src/notes.js),
 *   properties(f): HTML, show(on): expands or minimises the panel, shown(): whether it's expanded,
 * }
 */
export function mountPanels(o) {
  const panel = document.createElement('div');
  panel.id = 'files';
  panel.className = 'pg-panel pg-files cv-panel';
  panel.innerHTML = `<button type="button" class="pg-rail" aria-expanded="true" aria-controls="files-body" title="Expand (P)">
      <span class="pg-rail-arrow" aria-hidden="true">›</span><span class="pg-rail-label">Properties</span><span class="pg-rail-dot" hidden></span>
    </button><div class="pg-body" id="files-body"><div class="pg-pane" data-pane="props"></div><div class="pg-pane" data-pane="files" hidden></div><div class="pg-pane" data-pane="library" hidden></div></div>`;
  document.getElementById('side-props').append(panel);
  const rail = panel.querySelector('.pg-rail'), railDot = panel.querySelector('.pg-rail-dot');
  rail.addEventListener('click', () => open(null));
  const propsEl = panel.querySelector('[data-pane=props]');
  const filesEl = panel.querySelector('[data-pane=files]');
  const libraryEl = panel.querySelector('[data-pane=library]');
  const tabs = (on) => `<div class="pg-ptabs" role="tablist" aria-label="Properties, Files or Library">${[['props', 'Properties'], ['files', 'Files'], ['library', 'Library']]
    .map(([k, t]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${k === on}" class="${k === on ? 'on' : ''}">${t}</button>`).join('')}</div>`;

  let pane = 'props', about = null; // the frame Files shows
  try { pane = JSON.parse(localStorage.getItem(`${o.key}.pane`)) || 'props'; } catch {}

  // ---- Properties ----
  propsEl.innerHTML = `<div class="pg-head">${tabs('props')}<button type="button" class="pg-min" data-close aria-label="Minimise the panel" title="Minimise (P)">‹</button></div><div class="cv-props"></div>`;
  propsEl.querySelector('[data-close]').addEventListener('click', () => close());
  // The part picked with Inspect: its frame, the parts around it (innermost
  // first) and the one shown. It's outlined on its frame.
  let picked = null;
  const drawProps = () => {
    const f = o.target();
    if (picked && picked.f !== f) unpick();
    propsEl.querySelector('.cv-props').innerHTML = o.properties(f) + (picked ? designHTML(picked.levels, picked.at) : '');
  };
  const outlinePicked = () => {
    for (const el of document.querySelectorAll('.cv-picked')) el.remove();
    const l = picked?.levels[picked.at];
    if (!l?.box) return;
    const [x, y, w, h] = l.box, el = document.createElement('div');
    el.className = 'cv-picked';
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    picked.f.body.append(el);
  };
  const onNow = (f) => `${f.route?.screen ?? f.screen}|${f.v ?? 'main'}`;
  function pick(f, levels, at) {
    picked = { f, levels, at, on: onNow(f) };
    o.select?.(f);
    open(f, 'props');
    loadSystem().then(() => { drawProps(); outlinePicked(); });
  }
  function unpick() { picked = null; outlinePicked(); }
  propsEl.addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv && picked) { picked.at = +lv.dataset.level; drawProps(); outlinePicked(); return; }
    const lib = e.target.closest('[data-library]');
    if (lib) { open(null, 'library'); library.open(lib.dataset.library); }
  });
  const frameOf = () => (about && o.frames.includes(about) ? about : o.target());
  const nameOf = (f) => (f.kind === 'main' ? 'Main' : `${f.group} ${f.v.slice(1)}`);
  const titleOf = (id) => o.screens[id]?.title || id;

  // ---- Files ----
  const onShow = () => {
    const f = frameOf();
    if (!f) return [];
    const out = [], add = (path, label) => { if (path && !out.some((x) => x.path === path)) out.push({ path, label }); };
    const screen = f.route?.screen ?? f.screen;
    add(o.screens[screen]?.file, `${titleOf(screen)}, as main has it`);
    if (f.kind === 'exp') {
      if (f.pg.screen !== screen) add(o.screens[f.pg.screen]?.file, `${titleOf(f.pg.screen)}, as main has it`);
      add(`${o.data}/${f.pg.id}/${f.v}/`, `${nameOf(f)}: the iteration on show`);
      const it = f.iters.find((x) => x.id === f.v);
      if (it?.from && it.from !== f.v) add(`${o.data}/${f.pg.id}/${it.from}/`, `${f.group} ${it.from.slice(1)}: what it started from`);
      add(`${o.data}/${f.pg.id}/versions.json`, `${f.group}'s versions`);
    }
    add(`${o.data}/picks.json`, 'The picks, for Commit');
    return out;
  };
  const describe = () => {
    const d = new Map([
      ['playground/playground.json', 'The playground'], ['playground/RULES.md', 'Its rules for Claude'],
      [`${o.data}/screens.json`, 'The screens'], [`${o.data}/index.json`, 'The screens with explorations'], [`${o.data}/picks.json`, 'The picks'],
    ]);
    for (const [id, s] of Object.entries(o.screens)) if (s.file) d.set(s.file, s.title || id);
    for (const pg of o.playgrounds) {
      d.set(`${o.data}/${pg.id}`, pg.title || pg.id);
      d.set(`${o.data}/${pg.id}/versions.json`, 'Its versions');
      for (const v of pg.versions) if (v.id !== 'default') d.set(`${o.data}/${pg.id}/${v.id}`, `${v.id.slice(1)} · ${v.name}`);
    }
    return d;
  };
  const files = new FilesView(filesEl, {
    key: o.key, head: tabs('files'), onShow, describe,
    showSummary: () => { const f = frameOf(); return f ? `Behind ${nameOf(f)}` : 'Select a frame to see the files behind it'; },
    toggle: () => close(),
    onFresh: (on) => { railDot.hidden = !on; railDot.title = on ? 'Files are changing' : ''; },
  });

  // ---- Library: the selected frame's app answers ----
  const live = () => { const f = o.target(); return f?.ready ? f : null; };
  const reached = (f, screen) => new Promise((ok) => {
    const t0 = performance.now();
    const tick = () => ((f.route?.screen === screen) ? requestAnimationFrame(() => ok(true)) : performance.now() - t0 > 4000 ? ok(false) : setTimeout(tick, 60));
    tick();
  });
  const visit = async (screen) => {
    const f = live();
    if (!f) return false;
    if (f.route?.screen === screen) return true;
    o.send(f, { type: 'show', screen });
    return reached(f, screen);
  };
  const toClient = (f, [x, y, w, h]) => {
    const b = f.body.getBoundingClientRect(), k = b.width / o.W;
    return { left: b.left + x * k, top: b.top + y * k, width: w * k, height: h * k, right: b.left + (x + w) * k, bottom: b.top + (y + h) * k };
  };
  const ring = (rects) => {
    for (const r of rects) {
      const el = document.createElement('div');
      el.className = 'pg-ring';
      Object.assign(el.style, { position: 'fixed', left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
      document.body.append(el);
      setTimeout(() => el.remove(), 2600);
    }
  };
  const library = new LibraryView(libraryEl, {
    head: tabs('library'), toast: o.toast, toggle: () => close(),
    route: () => (inspectAt?.route || o.target()?.route),
    visit,
    locate: async ({ screen, nodes = [], components = [] }) => {
      const f = live();
      if (!f) throw new Error('Select a frame and let it load.');
      if (screen && !await visit(screen)) return -1;
      const m = await o.ask(f, { type: 'locate', nodes, components }, 3000);
      ring((m.boxes || []).map((b) => toClient(f, b)));
      return (m.boxes || []).length;
    },
    picture: (items, size = 320) => { const f = live(); return f ? o.ask(f, { type: 'picture', items, size }, 20000).then((m) => m.shots || {}) : Promise.reject(new Error('No live frame.')); },
    draw: (specimens, scale = 1) => { const f = live(); return f ? o.ask(f, { type: 'draw', specimens, scale }, 30000).then((m) => ({ shots: m.shots || {}, failed: m.failed || {} })) : Promise.reject(new Error('No live frame.')); },
    screenTitle: titleOf,
    openFile: (path) => { library.close(); setPane('files'); files.selected = path; files.reader.show(path); files.draw(); },
    onOpen: () => { if (!files.reader.el.hidden) files.reader.close(); },
    // A component's explorations on the canvas: the classic playground's other ones aren't frames here.
    explorations: (id) => o.playgrounds.filter((pg) => pg.component === id)
      .map((pg) => ({ ...pg, versions: pg.versions.filter((v) => o.frames.some((f) => f.pg?.id === pg.id && f.iters.some((x) => x.id === v.id))) }))
      .filter((pg) => pg.versions.length),
    picked: () => null, trying: () => null,
    versionName: (pg, v) => `${pg.title || pg.id} ${v.slice(1)}`,
    tryVersion: (pg, v) => o.showVersion(`${pg.id}/${v}`),
  });

  function setPane(p) {
    pane = p;
    try { localStorage.setItem(`${o.key}.pane`, JSON.stringify(p)); } catch {}
    rail.querySelector('.pg-rail-label').textContent = { props: 'Properties', files: 'Files', library: 'Library' }[p];
    propsEl.hidden = p !== 'props';
    filesEl.hidden = p !== 'files';
    libraryEl.hidden = p !== 'library';
    if (p === 'library') { library.load(); if (!files.reader.el.hidden) files.reader.close(); }
    else if (p === 'files') { files.draw(); if (!library.reader.hidden) library.close(); }
    else drawProps();
  }
  panel.addEventListener('click', (e) => { const t = e.target.closest('[data-ptab]'); if (t) setPane(t.dataset.ptab); });

  function open(f, p = pane) {
    if (f) about = f;
    o.show(true);
    setPane(p);
  }
  function close() {
    o.show(false);
    if (!files.reader.el.hidden) files.reader.close();
    if (!library.reader.hidden) library.close();
  }

  // ---- Inspect ----
  let inspectAt = null; // the frame last hovered
  const frameAt = (cx, cy) => o.frames.find((f) => {
    if (!f.ready) return false;
    const b = f.iframe.getBoundingClientRect();
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  });
  const inspector = mountInspect({
    library,
    hooks: {
      toast: o.toast,
      route: () => inspectAt?.route,
      inspect: async (cx, cy, withLibrary) => {
        const f = frameAt(cx, cy);
        if (!f) return null;
        inspectAt = f;
        const b = f.iframe.getBoundingClientRect(), k = b.width / o.W;
        const m = await o.ask(f, { type: 'inspect', x: (cx - b.left) / k, y: (cy - b.top) / k, library: withLibrary, design: true }, 2000);
        return { chain: (m.chain || []).map((c) => ({ ...c, rect: toClient(f, c.box) })) };
      },
      pick: (levels, at) => { if (inspectAt) pick(inspectAt, levels, at); },
    },
    open: (id) => { open(null, 'library'); library.open(id); },
    onStart: () => o.notes()?.set(false),
  });

  return {
    open, close,
    toggle: () => (o.shown() ? close() : open(null)),
    inspector,
    // The selected frame or the one on show in Files changed (an iteration, a screen).
    changed(f) {
      if (picked?.f === f && picked.on !== onNow(f)) unpick(); // another page or iteration: the part isn't there
      if (f === o.target()) drawProps();
      if (o.shown() && pane === 'files' && (f === frameOf() || f === o.target())) files.draw();
      if (f === o.target() && f.route?.screen) library.onScreen?.(f.route.screen);
    },
    selected(f) { about = f; drawProps(); if (o.shown() && pane === 'files') files.draw(); },
    drawProps,
    start() { setPane(pane); },
  };
}
