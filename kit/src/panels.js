// The canvas's one panel (src/canvas.js): Files and Library, the classic
// playground's left panel, opened from a frame's Files chip and floating over
// the canvas until it's closed. Part of the prototype-playground kit.
//
// - Files (files.js) shows "On show" for the frame it was opened from (or the
//   selected one): the file main draws the screen from, the iteration's
//   folder, and its exploration's versions.json. Changed and All files are
//   the project's, as in the classic playground. The reader opens beside it.
// - Library (library.js) asks the selected frame's app to point at, picture
//   and draw components.
// - Inspect (inspect.js, I): hover any live frame to see which component each
//   part is; a click opens it in the Library. Inspect and note mode turn each
//   other off.

import { FilesView } from './files.js';
import { LibraryView } from './library.js';
import { mountInspect } from './inspect.js';

/**
 * o: {
 *   key, data, W, screens, playgrounds, frames,
 *   ask(f, message, wait), send(f, message),
 *   target(): the selected frame,
 *   showVersion('<screen>/<version>'), toast(text), notes(): the notes (src/notes.js),
 * }
 */
export function mountPanels(o) {
  const ws = document.getElementById('workspace');
  const panel = document.createElement('aside');
  panel.id = 'files';
  panel.className = 'pg-panel pg-files cv-panel';
  panel.setAttribute('aria-label', 'Files and Library');
  panel.hidden = true;
  panel.innerHTML = '<div class="pg-body"><div class="pg-pane" data-pane="files"></div><div class="pg-pane" data-pane="library" hidden></div></div>';
  ws.append(panel);
  const filesEl = panel.querySelector('[data-pane=files]');
  const libraryEl = panel.querySelector('[data-pane=library]');
  const tabs = (on) => `<div class="pg-ptabs" role="tablist" aria-label="Files or Library">${[['files', 'Files'], ['library', 'Library']]
    .map(([k, t]) => `<button type="button" role="tab" data-ptab="${k}" aria-selected="${k === on}" class="${k === on ? 'on' : ''}">${t}</button>`).join('')}</div>`;

  let pane = 'files', about = null; // the frame Files shows
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
    explorations: (id) => o.playgrounds.filter((pg) => pg.component === id),
    picked: () => null, trying: () => null,
    versionName: (pg, v) => `${pg.title || pg.id} ${v.slice(1)}`,
    tryVersion: (pg, v) => o.showVersion(`${pg.id}/${v}`),
  });

  function setPane(p) {
    pane = p;
    filesEl.hidden = p !== 'files';
    libraryEl.hidden = p !== 'library';
    if (p === 'library') { library.load(); if (!files.reader.el.hidden) files.reader.close(); }
    else { files.draw(); if (!library.reader.hidden) library.close(); }
  }
  panel.addEventListener('click', (e) => { const t = e.target.closest('[data-ptab]'); if (t) setPane(t.dataset.ptab); });

  function open(f, p = pane) {
    if (f) about = f;
    panel.hidden = false;
    setPane(p);
  }
  function close() {
    panel.hidden = true;
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
        const m = await o.ask(f, { type: 'inspect', x: (cx - b.left) / k, y: (cy - b.top) / k, library: withLibrary }, 2000);
        return { chain: (m.chain || []).map((c) => ({ ...c, rect: toClient(f, c.box) })) };
      },
    },
    open: (id) => { open(null, 'library'); library.open(id); },
    onStart: () => o.notes()?.set(false),
  });

  return {
    open, close,
    toggle: () => (panel.hidden ? open(null) : close()),
    inspector,
    // The selected frame or the one on show in Files changed (an iteration, a screen).
    changed(f) {
      if (!panel.hidden && (f === frameOf() || f === o.target())) files.draw();
      if (f === o.target() && f.route?.screen) library.onScreen?.(f.route.screen);
    },
    selected(f) { about = f; if (!panel.hidden) files.draw(); },
  };
}
