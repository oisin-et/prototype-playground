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
import { cssOf, designHTML, loadSystem } from './design.js';

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
  // first), the one shown, and the scope of a change (this one, or every use
  // of its component). It's outlined on its frame.
  let picked = null;
  // What a change goes on: this part (its node id and component; a node a
  // template repeats matches each copy), or every use of its component.
  const selOf = (l, scope) => (!l ? null : scope === 'all' || !l.pg ? `[data-component="${CSS.escape(l.component)}"]`
    : `[data-pg="${CSS.escape(l.pg)}"][data-component="${CSS.escape(l.component)}"]`);
  const frameName = (f) => (f.kind === 'main' ? 'Main' : `${f.group} ${f.v.slice(1)}`);
  const drawProps = () => {
    const f = o.target();
    if (picked && picked.f !== f) unpick();
    let html = '';
    if (picked) {
      const l = picked.levels[picked.at], scope = l?.pg ? picked.scope : 'all', sel = selOf(l, scope);
      const entry = picked.saved.find((x) => x.sel === sel);
      html = designHTML(picked.levels, picked.at, {
        dials: entry?.dials || {}, scope, canOne: !!l?.pg, busy: picked.busy, sides: picked.sides,
        where: picked.f.kind === 'main'
          ? `Main doesn't change here: the first change starts a new exploration of ${o.screens[picked.f.route?.screen ?? picked.f.screen]?.title || 'this page'}, and saves in it.`
          : `Changes save in ${frameName(picked.f)}, in its design.json.`,
        whereShort: picked.f.kind === 'main' ? 'A change starts an exploration' : `Saves in ${frameName(picked.f)}`,
      });
    }
    propsEl.querySelector('.cv-props').innerHTML = o.properties(f) + html;
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
  // The changes saved in the frame's iteration (system.py's design.json).
  const loadSaved = (f) => (f.kind !== 'exp' ? Promise.resolve([])
    : fetch(`/playground/design?playground=${encodeURIComponent(f.pg.id)}&version=${encodeURIComponent(f.v)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((d) => d.styles || []).catch(() => []));
  async function pick(f, levels, at) {
    picked = { f, levels, at, on: onNow(f), scope: picked?.f === f ? picked.scope : 'one', sides: false, saved: [] };
    o.select?.(f);
    open(f, 'props');
    const [, saved] = await Promise.all([loadSystem(), loadSaved(f)]);
    if (picked?.f !== f) return;
    picked.saved = saved;
    drawProps();
    outlinePicked();
  }
  function unpick() { picked = null; outlinePicked(); }
  // After a change: the part measured again (its box and look), so the
  // outline and the values follow it.
  async function remeasure() {
    const p = picked, l = p?.levels[p.at];
    if (!l?.box) return;
    const [x, y, w, h] = l.box;
    const m = await o.ask(p.f, { type: 'inspect', x: x + w / 2, y: y + h / 2, library: true, design: true }, 2000).catch(() => null);
    if (p !== picked || !m?.chain) return;
    for (const c of m.chain) {
      const old = p.levels.find((q) => q.pg === c.pg && q.component === c.component);
      if (old) Object.assign(old, { box: c.box, style: c.style, tokens: c.tokens, raw: c.raw });
    }
    drawProps();
    outlinePicked();
  }
  // A dial's step, saved at once in the frame's iteration (on Main, in a new
  // exploration, which the canvas then opens). dials: the part's whole set.
  async function save(dials) {
    const p = picked, l = p?.levels[p.at];
    if (!l || p.busy) return;
    const [bx, by, bw, bh] = l.box || [0, 0, 0, 0];
    const scope = l.pg ? p.scope : 'all', sel = selOf(l, scope);
    const props = Object.fromEntries(Object.entries(dials).flatMap(([k, v]) => cssOf(k, v)));
    const label = `${l.item?.name || l.component}${scope === 'all' ? ', every use' : l.pg ? ` ${l.pg}` : ''}`;
    const body = p.f.kind === 'exp'
      ? { playground: p.f.pg.id, version: p.f.v, sel, label, dials, props }
      : { screen: p.f.route?.screen ?? p.f.screen, name: `Design: ${l.item?.name || l.component}`, sel, label, dials, props };
    p.busy = true;
    drawProps();
    const r = await fetch('/playground/design', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'design' }, body: JSON.stringify(body) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    p.busy = false;
    if (r.error) { o.toast(r.error); drawProps(); return; }
    // The canvas lays out again with the new exploration, and picks the same part in it.
    if (r.made) { o.opened?.(r.playground, r.version, { x: bx + bw / 2, y: by + bh / 2, pg: l.pg, component: l.component, scope: p.scope }); return; }
    if (p !== picked) return;
    p.saved = r.styles || [];
    await o.ask(p.f, { type: 'design' }, 3000).catch(() => null);
    remeasure();
  }
  // A dial: drag its knob along the steps (it snaps to each), or click a step,
  // or use the arrow keys. While it moves the part changes live (a preview,
  // the bridge's restyle); letting go saves it.
  const dialSteps = (el) => JSON.parse(el.dataset.steps);
  const dialAt = (el, x) => {
    const r = el.getBoundingClientRect(), n = dialSteps(el).length, kw = 52;
    return Math.max(0, Math.min(n - 1, Math.round(((x - r.left - 4 - kw / 2) / (r.width - 8 - kw)) * (n - 1))));
  };
  const withStep = (dials, prop, value) => {
    const next = { ...dials };
    if (prop === 'p') { delete next.pt; delete next.pr; delete next.pb; delete next.pl; }
    else if (['pt', 'pr', 'pb', 'pl'].includes(prop) && 'p' in next) { for (const k of ['pt', 'pr', 'pb', 'pl']) next[k] ??= next.p; delete next.p; }
    next[prop] = value;
    return next;
  };
  let drag = null;
  function moveDial(el, i) {
    const steps = dialSteps(el), [value, label] = steps[i];
    el.style.setProperty('--i', i);
    el.querySelector('.dl-knob').textContent = label;
    el.classList.remove('grid', 'off');
    el.classList.add('on', 'changed');
    el.setAttribute('aria-valuetext', label);
    const p = picked, l = p?.levels[p.at];
    if (!l) return value;
    const sel = selOf(l, l.pg ? p.scope : 'all');
    o.ask(p.f, { type: 'restyle', key: `drag:${sel}`, sel, props: Object.fromEntries(cssOf(el.dataset.prop, value)) }, 2000).catch(() => {});
    return value;
  }
  const settle = (el, value) => save(withStep(savedDials(), el.dataset.prop, value))
    .then(() => (picked ? o.ask(picked.f, { type: 'restyle', clear: true }, 2000).catch(() => {}) : null));
  propsEl.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.dl');
    if (!el || !picked || e.button !== 0 || picked.busy) return;
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch {}
    el.classList.add('dragging');
    const i = dialAt(el, e.clientX);
    drag = { el, i, value: moveDial(el, i) };
  });
  propsEl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const i = dialAt(drag.el, e.clientX);
    if (i !== drag.i) { drag.i = i; drag.value = moveDial(drag.el, i); }
  });
  const endDrag = () => {
    if (!drag) return;
    const { el, value } = drag;
    drag = null;
    el.classList.remove('dragging');
    settle(el, value);
  };
  propsEl.addEventListener('pointerup', endDrag);
  propsEl.addEventListener('pointercancel', endDrag);
  propsEl.addEventListener('keydown', (e) => {
    const el = e.target.closest?.('.dl');
    if (!el || !picked || picked.busy || !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const n = dialSteps(el).length, now = Number(getComputedStyle(el).getPropertyValue('--i'));
    const i = Math.max(0, Math.min(n - 1, (e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? Math.ceil(now) - 1 : Math.floor(now) + 1)));
    settle(el, moveDial(el, i));
  });
  const savedDials = () => {
    const l = picked?.levels[picked.at];
    return { ...(picked?.saved.find((x) => x.sel === selOf(l, l?.pg ? picked.scope : 'all'))?.dials || {}) };
  };
  propsEl.addEventListener('click', (e) => {
    const lv = e.target.closest('[data-level]');
    if (lv && picked) { picked.at = +lv.dataset.level; drawProps(); outlinePicked(); return; }
    const sc = e.target.closest('[data-scope]');
    if (sc && picked) { picked.scope = sc.dataset.scope; drawProps(); return; }
    if (e.target.closest('[data-sides]') && picked) { picked.sides = !picked.sides; drawProps(); return; }
    if (e.target.closest('[data-remove]') && picked) { save({}); return; }
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
    // Picks the part at x, y (app pixels) in f again, at the level named by pg and component.
    async repick(f, { x, y, pg, component, scope }) {
      const m = await o.ask(f, { type: 'inspect', x, y, library: true, design: true }, 3000).catch(() => null);
      const chain = inspector.identify?.(m?.chain || []) || m?.chain || [];
      const at = Math.max(0, chain.findIndex((c) => c.pg === pg && c.component === component));
      if (!chain.length) return;
      await pick(f, chain, at);
      if (picked) { picked.scope = scope || 'one'; drawProps(); }
    },
    drawProps,
    start() { setPane(pane); },
  };
}
