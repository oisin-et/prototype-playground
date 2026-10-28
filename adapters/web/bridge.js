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
//   host → app  {type: 'layers', layers: ['settings/compact/v1', …]}
//               the versions to run, in <data>/index.json order
//               {type: 'show', screen}             open that screen
//               {type: 'capture', id, rect, scale} draw part of the app
//               {type: 'inspect', id, x, y}        the element at a point, for a note
//   app → host  {type: 'hello', versions: {id: [screens]}, errors: [text]}
//               the versions in the registry, sent when the app starts, and
//               any that didn't load
//               {type: 'errors', errors: [text]}   a version's builder failed
//               {type: 'where', screen, params, title?}   the screen on show
//               {type: 'captured', id, png, note}  a capture's PNG (base64)
//               {type: 'inspected', id, box, widget, location, text}
//
// It also passes on what the playground needs while the app has the focus:
// ⌥ (to capture), P (the panels), N (notes), Esc, Space (to pan the canvas),
// the canvas's zoom (⌘+, ⌘−, ⌘0, ⇧1, pinch and ⌘-scroll), and pastes and ⌘V
// outside the app's own text fields, which go to the Claude panel's chat box.
//
// Where a note or capture says what's under it, the element is named from its
// data-pg attribute if it has one (put data-pg="Card" on the parts worth
// naming), else from its tag, id and classes; data-source="src/x.jsx:12" adds
// where it was built.

import * as built from './registry.js';

const registry = built.default || {};

const hostParam = new URLSearchParams(location.search).get('playground');
let origin = null;
try { if (hostParam && window.parent !== window) origin = new URL(hostParam).origin; } catch {}

/** Whether the app runs inside the playground page. */
export const embedded = origin !== null;

let layers = [];
let stamp = 0; // changes whenever the layers do, for useSyncExternalStore and the like
const listeners = new Set();
let hooks = { show: null, where: null };

const post = (m) => { if (embedded) window.parent.postMessage(JSON.stringify(m), origin); };

/**
 * Called once by the app. show(screen) opens a screen by id; where() says
 * which is on show, as {screen, params, title?}.
 */
export function attach({ show, where }) {
  hooks = { show, where };
  if (!embedded) return;
  post({
    type: 'hello',
    versions: Object.fromEntries(Object.entries(registry).map(([id, v]) => [id, Object.keys(v?.pages || {})])),
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
  });
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
    const { x, y, w, h } = m.rect;
    const scale = m.scale || 2;
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
    else if (e.key === 'Escape') send({ type: 'key', key: 'Escape', down: true });
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'p', down: true });
    else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'n', down: true });
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v' && !editable(e.target)) catchPaste();
  }, true);
  addEventListener('keyup', (e) => {
    if (e.key === 'Alt') send({ type: 'key', key: 'Alt', down: false });
    if (e.code === 'Space') send({ type: 'key', key: 'Space', down: false });
  }, true);
  addEventListener('blur', () => { send({ type: 'key', key: 'Alt', down: false }); send({ type: 'key', key: 'Space', down: false }); });
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
