// The prototype-playground kit: the bridge between a web app and the
// playground page (playground/README.md), which runs the app in a frame with
// ?playground=<its origin>. Opened any other way, it does nothing, and
// page() returns the app's own screen.
//
// Setup copies it into the project's playground data folder, next to the
// registry it reads. The app's hook (HOOK.md in the skill's adapters/web/)
// calls attach() once, wraps each screen in page(), and calls report() when
// the screen on show changes:
//
//   host → app  {type: 'layers', layers: ['settings/v4.2', …]}
//               the versions to run, in <data>/index.json order
//               {type: 'show', screen}             open that screen
//               {type: 'capture', id, rect, scale} draw part of the app
//               {type: 'capture', id, selector, width} draw the element
//               (else the whole app) width pixels wide: a version's picture
//               {type: 'inspect', id, x, y, library?, design?}   the element at a point, for a
//               note; with library, the components around it too, for Inspect;
//               with design, each with its look (style), for the canvas's Properties
//               {type: 'locate', id, nodes, components}   where these are, for the Library
//               {type: 'picture', id, items: [{key, nodes, components}], size}
//               a picture of the first of each in view, for the Library
//               {type: 'draw', id, specimens: [{key, node, size}], scale}
//               each drawn on its own by the app's draw(), for the Library
//   app → host  {type: 'hello', versions: {id: [screens]}, components: {id: [names]}, errors: [text]}
//               the versions in the registry, sent when the app starts, and
//               any that didn't load
//               {type: 'errors', errors: [text]}   a version's builder failed
//               {type: 'where', screen, params, title?}   the screen on show
//               {type: 'captured', id, png, note}  a capture's PNG (base64)
//               {type: 'inspected', id, box, widget, location, text, chain?}
//               {type: 'xrayed', id, elements: [{box, parent, s, pad, name}]}  (X-ray)
//               {type: 'located', id, boxes: [[x, y, w, h]]}
//               {type: 'pictured', id, shots: {key: png}}   (base64)
//               {type: 'drawn', id, shots: {key: png}, failed: {key: text}}
//
// It also passes on what the playground needs while the app has the focus:
// ⌥ (to capture), P (the panels), N (notes), I (Inspect), Esc, Space (to pan the canvas),
// the canvas's zoom (⌘+, ⌘−, ⌘0, ⇧1, pinch and ⌘-scroll), and pastes and ⌘V
// outside the app's own text fields, which go to the Claude panel's chat box.
//
// Where a note or capture says what's under it, the element is named from its
// data-pg attribute if it has one (put data-pg="Card" on the parts worth
// naming), else from its tag, id and classes; data-source="src/x.jsx:12" adds
// where it was built. For the Library, data-component="Fader" says which of
// the library's components an element draws, and data-pg its node's id.

import * as built from './registry.js';

const registry = built.default || {};

// The playground's address comes in ?playground=. A full page load inside the
// frame that drops it (a sign-in that sets location, a server redirect) would
// leave the app out of the playground, so the frame keeps it for its session.
const HOST_KEY = 'playground.host';
const hostParam = (() => {
  const fromUrl = new URLSearchParams(location.search).get('playground');
  try {
    if (fromUrl) sessionStorage.setItem(HOST_KEY, fromUrl);
    else if (window.parent !== window) return sessionStorage.getItem(HOST_KEY);
  } catch {}
  return fromUrl;
})();
let origin = null;
try { if (hostParam && window.parent !== window) origin = new URL(hostParam).origin; } catch {}

/** Whether the app runs inside the playground page. */
export const embedded = origin !== null;

let layers = [];
let stamp = 0; // changes whenever the layers do, for useSyncExternalStore and the like
const listeners = new Set();
let hooks = { show: null, where: null, draw: null };

const post = (m) => { if (embedded) window.parent.postMessage(JSON.stringify(m), origin); };

/**
 * Called once by the app. show(screen) opens a screen by id; where() says
 * which is on show, as {screen, params, title?}. draw(node, [w, h]), if the
 * app has it, draws one component on its own, as the app would, for the
 * Library's specimens: node is as the app's screens place it (its frame at
 * 0, 0), and it returns an element or HTML.
 */
export function attach({ show, where, draw = null }) {
  hooks = { show, where, draw };
  if (!embedded) return;
  post({
    type: 'hello',
    versions: Object.fromEntries(Object.entries(registry).map(([id, v]) => [id, Object.keys(v?.pages || {})])),
    components: Object.fromEntries(Object.entries(registry).map(([id, v]) => [id, [...Object.keys(v?.components || {}), ...Object.keys(v?.parts || {})]]).filter(([, n]) => n.length)),
    errors: built.errors || [],
  });
  report();
}

/** Tells the host which screen is on show. Call it on every navigation. */
export function report() {
  if (embedded && hooks.where) post({ type: 'where', ...hooks.where() });
}

/**
 * original, with every running version that changes screen laid over it, in
 * index.json order. Each builder gets {below, app, ...ctx}: below is the
 * screen under it, app the app's own. What a builder returns is up to the
 * project (a React element, a DOM node, …), as long as it's what original is.
 */
export function page(screen, original, ctx = {}) {
  if (!embedded || !layers.length) return original;
  let out = original;
  for (const id of layers) {
    const build = registry[id]?.pages?.[screen];
    if (!build) continue;
    // A builder that throws is passed over, and the playground's bar says why.
    try { out = build({ ...ctx, below: out, app: original }); } catch (e) { fail(`${id} (${screen}): ${e?.message || e}`); }
  }
  return out;
}

/**
 * A component's renderer, with every running version that changes it laid
 * over it ("components" in a version: name → builder), for a component
 * exploration: it changes the component wherever the app draws it. Each
 * builder gets {below, app}: the renderer under it and the app's own, and
 * returns a renderer of the same kind. part() does the same for a shared part
 * ("parts"). Both are kept until the versions to run change, so the app can
 * call them for every node it draws.
 */
export function component(name, original) { return layered('components', name, original); }
export function part(name, original) { return layered('parts', name, original); }
const memo = new Map();
let memoStamp = -1;
function layered(kind, name, original) {
  if (!embedded || !layers.length) return original;
  if (memoStamp !== stamp) { memo.clear(); memoStamp = stamp; }
  const key = `${kind}:${name}`;
  if (memo.has(key)) return memo.get(key);
  let out = original;
  for (const id of layers) {
    const build = registry[id]?.[kind]?.[name];
    if (!build) continue;
    try { out = build({ below: out, app: original }) ?? out; } catch (e) { fail(`${id} (${name}): ${e?.message || e}`); }
  }
  memo.set(key, out);
  return out;
}

const failed = new Set();
function fail(text) {
  console.error(`playground: ${text}`);
  if (failed.has(text)) return;
  failed.add(text);
  post({ type: 'errors', errors: [text] });
}

/** Calls fn when the versions to run change; returns a function that stops it. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** A value that changes whenever the versions to run do. */
export const version = () => stamp;

// ---- Messages from the host ------------------------------------------------------
addEventListener('message', (e) => {
  if (!embedded || e.origin !== origin || e.source !== window.parent || typeof e.data !== 'string') return;
  let m;
  try { m = JSON.parse(e.data); } catch { return; }
  if (m.type === 'layers') {
    const next = (m.layers || []).map(String);
    if (next.join('\n') !== layers.join('\n')) {
      layers = next;
      stamp++;
      for (const fn of listeners) fn();
    }
    // After the redraw, so a version that changes the screen on show reports it.
    requestAnimationFrame(() => requestAnimationFrame(report));
  } else if (m.type === 'show') {
    hooks.show?.(String(m.screen));
  } else if (m.type === 'capture') {
    capture(m);
  } else if (m.type === 'inspect') {
    inspect(m);
  } else if (m.type === 'locate') {
    locate(m);
  } else if (m.type === 'picture') {
    picture(m);
  } else if (m.type === 'draw') {
    drawSpecimens(m);
  } else if (m.type === 'xray') {
    xray(m);
  }
});

// ---- Naming elements ---------------------------------------------------------------
const named = (el) => el.closest?.('[data-pg]');
const nameOf = (el) => {
  if (el.dataset?.pg) return el.dataset.pg;
  const cls = [...(el.classList || [])].slice(0, 2).map((c) => `.${c}`).join('');
  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}`;
};
const locationOf = (el) => el.closest?.('[data-source]')?.dataset.source || nameOf(el);
const textOf = (el) => {
  const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  return t.length > 40 ? `${t.slice(0, 40)}…` : t;
};
const boxOf = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };

// The element at a point, for a note: the nearest one named with data-pg,
// else the element itself.
function inspect(m) {
  const at = document.elementFromPoint(m.x, m.y);
  const el = at && (named(at) || at);
  post({
    type: 'inspected', id: m.id,
    ...(el && el !== document.documentElement && el !== document.body
      ? { box: boxOf(el), widget: nameOf(el), location: locationOf(el), text: textOf(el) } : {}),
    ...(m.library ? { chain: chainAt(at, m.design) } : {}),
  });
}

// For Inspect: the library's components around a point, innermost first,
// each an element with data-component: its name, node id (data-pg), box, and
// what its drawing uses: the tokens (var(--…) in its and its children's
// style, fill and stroke, with their values here) and any colour written out
// instead of a token.
const RAW_COLOUR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
function looksOf(el) {
  const tokens = new Map(), raw = new Set();
  for (const e of [el, ...el.querySelectorAll('*')].slice(0, 200)) {
    for (const a of ['style', 'fill', 'stroke']) {
      const v = e.getAttribute?.(a);
      if (!v) continue;
      for (const t of v.matchAll(/var\(\s*(--[\w-]+)/g)) if (!tokens.has(t[1])) tokens.set(t[1], getComputedStyle(el).getPropertyValue(t[1]).trim());
      for (const c of v.replace(/var\([^)]*\)/g, '').matchAll(RAW_COLOUR)) raw.add(c[0]);
    }
  }
  return { tokens: [...tokens].slice(0, 12).map(([name, value]) => ({ name, value })), raw: [...raw].slice(0, 8) };
}
function chainAt(at, design) {
  const out = [];
  for (let el = at?.closest?.('[data-component]'); el && out.length < 8; el = el.parentElement?.closest('[data-component]')) {
    out.push({ component: el.dataset.component, pg: el.dataset.pg || null, box: boxOf(el), ...looksOf(el), ...(design ? { style: styleOf(el) } : {}) });
  }
  return out;
}
// For the canvas's Properties (Design): what an element's look is, as the
// browser works it out, in the app's own CSS pixels (a transform on a parent
// doesn't change them). A text's type only when it holds text of its own.
function styleOf(el) {
  const s = getComputedStyle(el), n = (v) => { const x = parseFloat(v); return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; };
  const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || (el.children.length === 0 && el.textContent.trim());
  const svg = el instanceof SVGElement;
  const box = svg && el.getBBox ? (() => { try { return el.getBBox(); } catch { return null; } })() : null;
  return {
    width: box ? n(box.width) : n(s.width), height: box ? n(box.height) : n(s.height),
    padding: [s.paddingTop, s.paddingRight, s.paddingBottom, s.paddingLeft].map(n),
    gap: s.display.includes('flex') || s.display.includes('grid') ? [n(s.rowGap), n(s.columnGap)] : null,
    radius: n(s.borderTopLeftRadius) ?? n(el.getAttribute?.('rx')),
    border: n(s.borderTopWidth),
    text: own ? { size: n(s.fontSize), weight: n(s.fontWeight), line: n(s.lineHeight), spacing: n(s.letterSpacing) || 0 } : null,
    color: own ? s.color : null,
    fill: svg ? s.fill : s.backgroundColor,
    stroke: svg && s.stroke !== 'none' ? s.stroke : null,
  };
}

// Where nodes or components are on show, for the Library: elements whose
// data-pg is one of the nodes ("{c}" in a node's id stands for any value, as
// in a repeated template's) or whose data-component is one of the components.
// Only what's in view, and not one inside another that's already found.
const pattern = (id) => new RegExp(`^${String(id).split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`);
function findAll({ nodes = [], components = [] }, max = 300) {
  const res = nodes.map(pattern), comps = new Set(components);
  const hits = [];
  for (const el of document.querySelectorAll('[data-pg], [data-component]')) {
    if (hits.length >= max) break;
    if (el.closest('[data-pg-specimens]')) continue;
    const { pg, component } = el.dataset;
    if (!(comps.has(component) || (pg && res.some((re) => re.test(pg))))) continue;
    if (hits.some((h) => h.contains(el))) continue;
    const [x, y, w, h] = boxOf(el);
    if (w && h && x < innerWidth && y < innerHeight && x + w > 0 && y + h > 0) hits.push(el);
  }
  return hits;
}
function locate(m) {
  post({ type: 'located', id: m.id, boxes: findAll(m).map(boxOf) });
}

// Pictures of components, for the Library: for each item ({key, nodes,
// components}), the first one in view, cut from one drawing of the page and
// at most `size` px on its longer side.
async function picture(m) {
  try {
    const found = (m.items || []).map((it) => [it.key, findAll(it, 1)[0]]).filter(([, el]) => el);
    const shots = {};
    if (found.length) {
      const { domToCanvas } = await import(/* @vite-ignore */ `${origin}/playground/src/vendor/modern-screenshot.mjs`);
      const scale = Math.min(2, 4096 / Math.max(innerWidth, innerHeight));
      const whole = await domToCanvas(document.documentElement, { scale, width: innerWidth, height: innerHeight, style: { margin: '0' } });
      const size = m.size || 320;
      for (const [key, el] of found) {
        const [x, y, w, h] = boxOf(el);
        const k = Math.min(scale, size / Math.max(w, h));
        const out = document.createElement('canvas');
        out.width = Math.max(1, Math.round(w * k));
        out.height = Math.max(1, Math.round(h * k));
        out.getContext('2d').drawImage(whole, x * scale, y * scale, w * scale, h * scale, 0, 0, out.width, out.height);
        shots[key] = out.toDataURL('image/png').split(',')[1];
      }
    }
    post({ type: 'pictured', id: m.id, shots });
  } catch (e) {
    post({ type: 'pictured', id: m.id, error: String(e?.message || e) });
  }
}

// What an area covers: the outermost named elements inside it (data-pg, or
// with an id), else the smallest one around it.
function coverage([x, y, w, h]) {
  const inside = [];
  let around = null;
  const walk = (el, under) => {
    const [l, t, bw, bh] = boxOf(el);
    const worth = el.dataset?.pg || el.id;
    let hit = under;
    if (worth && bw && bh) {
      if (!under && l >= x - 2 && t >= y - 2 && l + bw <= x + w + 2 && t + bh <= y + h + 2) { inside.push(el); hit = true; }
      else if (l <= x && t <= y && l + bw >= x + w && t + bh >= y + h) around = el;
    }
    for (const c of el.children) walk(c, hit);
  };
  walk(document.body, false);
  const name = (el) => { const t = textOf(el); return `${nameOf(el)} (${locationOf(el)}${t ? `, "${t}"` : ''})`; };
  const r = [x, y, w, h].map(Math.round);
  const list = inside.length
    ? `It covers ${inside.slice(0, 20).map(name).join('; ')}${inside.length > 20 ? `; and ${inside.length - 20} more` : ''}.`
    : around ? `It's inside ${name(around)}.` : '';
  return `The area at x ${r[0]}, y ${r[1]}, ${r[2]} × ${r[3]} of the app, in its CSS pixels. ${list}`.trim();
}

// ---- Capture -----------------------------------------------------------------------
// Draws the app with modern-screenshot, loaded from the playground's server,
// and cuts the area out at the scale asked for.
async function capture(m) {
  try {
    const { domToCanvas } = await import(/* @vite-ignore */ `${origin}/playground/src/vendor/modern-screenshot.mjs`);
    const el = m.selector ? document.querySelector(m.selector) : null;
    const box = el?.getBoundingClientRect();
    const { x, y, w, h } = m.rect || (box ? { x: box.left, y: box.top, w: box.width, h: box.height } : { x: 0, y: 0, w: innerWidth, h: innerHeight });
    const scale = m.width ? m.width / w : m.scale || 2;
    const whole = await domToCanvas(document.documentElement, {
      scale, width: innerWidth, height: innerHeight, style: { margin: '0' },
    });
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(w * scale));
    out.height = Math.max(1, Math.round(h * scale));
    out.getContext('2d').drawImage(whole, x * scale, y * scale, w * scale, h * scale, 0, 0, out.width, out.height);
    const png = out.toDataURL('image/png').split(',')[1];
    post({ type: 'captured', id: m.id, png, note: coverage([x, y, w, h]) });
  } catch (e) {
    post({ type: 'captured', id: m.id, error: String(e?.message || e) });
  }
}

// The Library's specimens: each drawn by the app's draw() in a layer the
// person can't see (so the app's own styles and tokens apply), pictured on
// its own, and taken away again.
async function drawSpecimens(m) {
  if (!hooks.draw) { post({ type: 'drawn', id: m.id, error: 'The app has no draw() in its playground hook.' }); return; }
  const layer = document.createElement('div');
  layer.dataset.pgSpecimens = '';
  layer.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;';
  document.body.append(layer);
  const shots = {}, failed = {};
  try {
    const { domToCanvas } = await import(/* @vite-ignore */ `${origin}/playground/src/vendor/modern-screenshot.mjs`);
    for (const s of m.specimens || []) {
      const [w, h] = s.size;
      const box = document.createElement('div');
      box.style.cssText = `position:relative;width:${w}px;height:${h}px;`;
      try {
        const drawn = hooks.draw(s.node, [w, h]);
        if (typeof drawn === 'string') box.innerHTML = drawn; else if (drawn) box.append(drawn);
        if (!box.firstChild) { failed[s.key] = 'Not drawn in this state'; continue; }
        layer.append(box);
        const canvas = await domToCanvas(box, { scale: m.scale || 1, width: w, height: h });
        shots[s.key] = canvas.toDataURL('image/png').split(',')[1];
      } catch (e) {
        failed[s.key] = String(e?.message || e);
      } finally {
        box.remove();
      }
    }
    post({ type: 'drawn', id: m.id, shots, failed });
  } catch (e) {
    post({ type: 'drawn', id: m.id, error: String(e?.message || e) });
  } finally {
    layer.remove();
  }
}

// For X-ray: every element drawn in an area (m.rect, in page pixels), in
// document order. Each says its box, the nearest element around it that's
// listed too (parent, or -1), its padding and its scale (page pixels to its
// own CSS pixels, below any transform), so the playground can measure sizes,
// padding and gaps in the app's own units. A wrapper the same size as the
// element around it stands in for that element, so it isn't listed twice.
function xray(m) {
  const { x = 0, y = 0, w = 0, h = 0 } = m.rect || {};
  const elements = [], index = new Map();
  const skip = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'BR', 'NOSCRIPT']);
  for (const el of document.body.querySelectorAll('*')) {
    if (elements.length >= 400) break;
    if (skip.has(el.tagName) || (el.closest('svg') && el.tagName.toLowerCase() !== 'svg')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.right <= x || r.left >= x + w || r.bottom <= y || r.top >= y + h) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    let parent = -1;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (index.has(p)) { parent = index.get(p); break; }
    }
    if (parent >= 0) {
      const b = elements[parent].box;
      if (Math.abs(b[0] - r.left) < 0.5 && Math.abs(b[1] - r.top) < 0.5 && Math.abs(b[2] - r.width) < 0.5 && Math.abs(b[3] - r.height) < 0.5) {
        index.set(el, parent);
        continue;
      }
    }
    const own = el.offsetWidth;
    const s = own ? r.width / own : parent >= 0 ? elements[parent].s : 1;
    index.set(el, elements.length);
    elements.push({
      box: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10),
      parent, s: Math.round(s * 1000) / 1000,
      pad: ['Top', 'Right', 'Bottom', 'Left'].map((k) => parseFloat(cs[`padding${k}`]) || 0),
      name: nameOf(el),
    });
  }
  post({ type: 'xrayed', id: m.id, elements });
}

// ---- Keys, zoom and pastes for the playground ---------------------------------------
if (embedded) {
  const send = (m) => post({ ...m, from: 'page' });
  const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  addEventListener('keydown', (e) => {
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    const zoom = mod && (e.key === '=' || e.key === '+') ? 'in' : mod && (e.key === '-' || e.key === '_') ? 'out'
      : mod && e.key === '0' ? 'actual' : e.shiftKey && e.code === 'Digit1' && !editable(e.target) ? 'fit' : null;
    if (zoom) { e.preventDefault(); e.stopPropagation(); send({ type: 'zoomkey', key: zoom }); return; }
    if (e.code === 'Space' && !editable(e.target) && !e.target.closest?.('button, a, summary, [role=button]')) {
      e.preventDefault(); e.stopPropagation(); if (!e.repeat) send({ type: 'key', key: 'Space', down: true }); return;
    }
    if (e.key === 'Alt') send({ type: 'key', key: 'Alt', down: true });
    else if (e.key === 'Shift') { if (!e.repeat) send({ type: 'key', key: 'Shift', down: true }); } // X-ray: ⇧-drag
    else if (e.key === 'Escape') send({ type: 'key', key: 'Escape', down: true });
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'p', down: true });
    else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'n', down: true });
    else if ((e.key === 'i' || e.key === 'I') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'i', down: true });
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v' && !editable(e.target)) catchPaste();
  }, true);
  addEventListener('keyup', (e) => {
    if (e.key === 'Alt') send({ type: 'key', key: 'Alt', down: false });
    if (e.key === 'Shift') send({ type: 'key', key: 'Shift', down: false });
    if (e.code === 'Space') send({ type: 'key', key: 'Space', down: false });
  }, true);
  addEventListener('blur', () => { send({ type: 'key', key: 'Alt', down: false }); send({ type: 'key', key: 'Space', down: false }); send({ type: 'key', key: 'Shift', down: false }); });
  // The page is going away (a dev server's full refresh, a sign-in redirect): until
  // the next one has a bridge, a frame with the focus swallows every key, a
  // dictation's ⌘V too. The playground takes the focus back meanwhile.
  const leaving = () => send({ type: 'leaving' });
  addEventListener('beforeunload', leaving);
  addEventListener('pagehide', leaving);
  // A pinch (Chrome sends it as a wheel with Ctrl) or ⌘-scroll zooms the
  // canvas, around the pointer; a plain scroll stays the app's.
  addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    send({ type: 'wheel', x: e.clientX, y: e.clientY, dx: e.deltaX, dy: e.deltaY });
  }, { capture: true, passive: false });
  // A ⌘V outside the app's text fields: a hidden box in the app takes the
  // focus until the paste lands in it, so every browser makes it a paste (and
  // nothing has to read the clipboard), then the focus goes back.
  const catcher = Object.assign(document.createElement('textarea'), { tabIndex: -1 });
  catcher.setAttribute('aria-hidden', 'true');
  catcher.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
  let before = null;
  const release = () => {
    if (!catcher.isConnected) return;
    const back = before;
    before = null;
    catcher.value = '';
    catcher.remove();
    if (back?.isConnected && back !== document.body) back.focus?.({ preventScroll: true });
  };
  const catchPaste = () => {
    before = document.activeElement;
    document.body.append(catcher);
    catcher.focus({ preventScroll: true });
    setTimeout(release, 500);
  };
  addEventListener('paste', async (e) => {
    if (editable(e.target) && e.target !== catcher) return;
    e.preventDefault();
    release();
    const images = await Promise.all([...(e.clipboardData?.files || [])]
      .filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type))
      .map((f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok({ type: f.type, url: r.result }); r.readAsDataURL(f); })));
    send({ type: 'paste', text: e.clipboardData?.getData('text/plain') || '', images });
  }, true);
}
