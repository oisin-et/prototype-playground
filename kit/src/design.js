// Design, in the canvas's Properties (src/panels.js): the part picked with
// Inspect, as dials, after Graphical UI. Part of the prototype-playground kit.
//
// Every value comes from the project's design system (system.py, "system"
// in playground.json): type size and weight, padding and gap, corner radius.
// Each is a dial: a pad with the system's steps as dots and a knob on the
// step in use, named by it (S, 16, Full). Drag the knob (or click a dot, or
// use the arrow keys) and the part changes live in its frame; letting go
// saves it in the iteration on show (panels.js). A value off the steps sits
// between them, its number in amber. Colours show as pills (the system's
// name for the colour, else its hex) and don't change yet.

import { ICON } from './icons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let system = null, loading = null;
// The system's scales, once: { name, grid, scales: { type, weight, radius, space, color } }.
export const loadSystem = () => (loading ??= fetch('/playground/system', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((s) => { system = s; return s; }));

// What each dial sets, as style properties ("p" is every side at once).
export const PILL = 9999;
const CSS = {
  size: ['fontSize'], weight: ['fontWeight'], radius: ['borderRadius'], gap: ['gap'],
  pt: ['paddingTop'], pr: ['paddingRight'], pb: ['paddingBottom'], pl: ['paddingLeft'],
  p: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'],
};
export const cssOf = (prop, v) => (CSS[prop] || []).map((k) => [k, prop === 'weight' ? String(v) : `${v}px`]);
// A part's whole set of dials as style properties. "x" and "y" (how far the
// space dials move a part the app places itself) are one: translate.
export const propsOf = (dials) => {
  const out = Object.fromEntries(Object.entries(dials).flatMap(([k, v]) => cssOf(k, v)));
  if ('x' in dials || 'y' in dials) out.translate = `${dials.x || 0}px ${dials.y || 0}px`;
  return out;
};

const hex = (css) => {
  const m = String(css || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return /^#/.test(css || '') ? css.toLowerCase() : null;
  const a = m[4] === undefined ? 1 : +m[4];
  if (a === 0) return 'none';
  const h = '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return a < 1 ? h + Math.round(a * 255).toString(16).padStart(2, '0') : h;
};

// A dial's steps for each kind of value: [{ value, label, title }].
function stepsFor(kind, v) {
  const s = system?.scales || {};
  if (kind === 'size') return (s.type || []).map((x) => ({ value: x.value, label: x.name, title: `${x.name} · ${x.value}px` }));
  if (kind === 'weight') return (s.weight || []).map((x) => ({ value: x.value, label: x.name, title: `${x.name} · ${x.value}` }));
  if (kind === 'radius') {
    return [{ value: 0, label: '0', title: 'Square' }, ...(s.radius || []).map((x) => ({ value: x.value, label: String(x.value), title: `${x.name} · ${x.value}px` })),
      { value: PILL, label: 'Full', title: 'Pill' }];
  }
  // Spacing: the steps up to 64, or up to the value if it's beyond. The space
  // around a part: up to 64, and the value itself when it's further.
  const top = kind === 'around' ? 64 : Math.max(64, v ?? 0);
  const out = (s.space || []).filter((x) => x.value <= top).map((x) => ({ value: x.value, label: String(x.value), title: `${system?.name || ''} ${x.name} · ${x.value}px` }));
  if (kind === 'around' && v > top) out.push({ value: v, label: String(Math.round(v)), title: `${Math.round(v)}px` });
  return out;
}

// Where a value sits on its steps: an index (between two when it's off them).
export function placeOn(steps, v) {
  const i = steps.findIndex((x) => Math.abs(x.value - v) < 0.5);
  if (i >= 0) return { i, on: true };
  if (v <= steps[0].value) return { i: 0, on: false };
  if (v >= steps.at(-1).value) return { i: steps.length - 1, on: false };
  const hi = steps.findIndex((x) => x.value > v), lo = hi - 1;
  return { i: lo + (v - steps[lo].value) / (steps[hi].value - steps[lo].value), on: false };
}

function dial(prop, label, v, kind, { changed, side, about } = {}) {
  if (v == null) return '';
  const steps = stepsFor(kind, v);
  if (steps.length < 2) return '';
  const { i, on } = placeOn(steps, v);
  const grid = system?.grid;
  const state = on ? 'on' : grid && Math.abs(v / grid - Math.round(v / grid)) < 0.01 ? 'grid' : 'off';
  const knob = on ? steps[Math.round(i)].label : v === PILL ? 'Full' : String(Math.round(v * 10) / 10);
  const title = on ? steps[Math.round(i)].title : `${v}: not one of ${system?.name || 'the system'}'s steps`;
  return `<div class="ds-row"><span class="ds-label"${about ? ` title="${esc(about)}"` : ''}>${esc(label)}</span>
    <div class="dl ${state}${changed ? ' changed' : ''}" data-prop="${prop}" data-steps="${esc(JSON.stringify(steps.map((x) => [x.value, x.label])))}"
      style="--n:${steps.length};--i:${i}" role="slider" tabindex="0" aria-label="${esc(label)}" aria-valuetext="${esc(knob)}" title="${esc(title)}">
      <span class="dl-dots">${steps.map(() => '<i></i>').join('')}</span><span class="dl-knob">${esc(knob)}</span>
    </div>${side || ''}</div>`;
}

// A colour: the system's name for it (or its hex), as a pill with its opacity.
function colour(label, css, tokens) {
  const h = hex(css);
  if (!h) return '';
  if (h === 'none') return `<div class="ds-row"><span class="ds-label">${esc(label)}</span><div class="ds-pill"><span class="ds-sw none"></span><span class="ds-cname">None</span></div><div class="ds-pct">–</div></div>`;
  const named = (system?.scales?.color || []).filter((x) => String(x.value).toLowerCase() === h);
  const own = (tokens || []).find((t) => hex(t.value) === h);
  const alpha = h.length === 9 ? Math.round(parseInt(h.slice(7), 16) / 2.55) : 100;
  const name = named[0]?.name.replace(/^O_/, '').replace(/_/g, ' ') || h.slice(0, 7);
  const title = named.length ? `${named[0].token}${own ? ` · app token ${own.name}` : ''}`
    : `Not one of ${system?.name || 'the system'}'s colours${own ? ` · app token ${own.name}` : ''}`;
  return `<div class="ds-row"><span class="ds-label">${esc(label)}</span>
    <div class="ds-pill${named.length ? '' : ' off'}" title="${esc(title)}"><span class="ds-sw" style="background:${esc(h)}"></span><span class="ds-cname">${esc(name)}</span></div>
    <div class="ds-pct">${alpha}%</div></div>`;
}

/**
 * The Design section for a picked part: levels (innermost first, from
 * Inspect: { component, pg, box, style, tokens, item }), at (the one shown),
 * and o: { dials (its saved changes), scope ('one' | 'all'), canOne,
 * sides (padding opened up), where (where changes save), busy }.
 */
export function designHTML(levels, at, o = {}) {
  const l = levels?.[at];
  if (!l) return '';
  const path = levels.map((x, i) => ({ x, i })).reverse()
    .map(({ x, i }) => `<button type="button" class="ds-crumb${i === at ? ' on' : ''}" data-level="${i}">${esc(x.item?.name || x.component)}</button>`).join('<span>›</span>');
  if (!system?.scales) {
    return `<section class="ds"><div class="ds-path">${path}</div>
      <p class="cv-pnone">${system?.error ? esc(system.error) : 'No design system is named for this project: add "system" to playground.json.'}</p></section>`;
  }
  const st = l.style || {}, d = o.dials || {};
  const now = (prop, measured) => (prop in d ? d[prop] : measured);
  const [, , bw, bh] = l.box || [];
  const minSide = Math.min(st.width || bw || 0, st.height || bh || 0);
  const radius = st.radius == null ? null : minSide && st.radius > 0 && st.radius >= minSide / 2 - 0.5 ? PILL : st.radius;
  const pad = (st.padding || []).map((x, i) => now(['pt', 'pr', 'pb', 'pl'][i], 'p' in d ? d.p : x));
  const even = pad.length === 4 && pad.every((x) => x === pad[0]);
  const sides = o.sides || !even;
  const sideBtn = `<button type="button" class="ds-icon${sides ? ' on' : ''}" data-sides title="${sides ? 'One value for every side' : 'Each side on its own'}" aria-pressed="${sides}">${ICON.sides}</button>`;
  const changed = (...k) => k.some((x) => x in d);
  // The space around a part the app places itself: a dial moves it.
  const ar = st.around, to = (side) => (ar.to[side] ? `The space to ${ar.to[side]}` : `The space to the edge of ${levels[at + 1]?.item?.name || levels[at + 1]?.component || 'the part it sits in'}`);
  const around = !ar ? '' : ['left', 'top', 'right', 'bottom'].map((k) => dial(`s${k[0]}`, k[0].toUpperCase() + k.slice(1), ar[k], 'around',
    { changed: changed(k === 'left' || k === 'right' ? 'x' : 'y'), about: to(k) })).join('');
  const usePad = pad.length && (!ar || pad.some((x) => x));
  const spacing = !usePad ? '' : sides
    ? dial('pt', 'Top', pad[0], 'space', { changed: changed('pt', 'p'), side: sideBtn }) + dial('pr', 'Right', pad[1], 'space', { changed: changed('pr', 'p') })
      + dial('pb', 'Bottom', pad[2], 'space', { changed: changed('pb', 'p') }) + dial('pl', 'Left', pad[3], 'space', { changed: changed('pl', 'p') })
    : dial('p', 'Padding', pad[0], 'space', { changed: changed('p', 'pt', 'pr', 'pb', 'pl'), side: sideBtn });
  const gap = st.gap ? dial('gap', 'Gap', now('gap', st.gap[0] || st.gap[1] || 0), 'space', { changed: changed('gap') }) : '';
  const n = Object.keys(d).length;
  const sec = (title, body) => (body ? `<div class="ds-sec"><h5>${title}</h5>${body}</div>` : '');
  const name = esc(l.item?.name || l.component);
  return `<section class="ds">
    <div class="ds-path">${path}</div>
    <div class="ds-seg" role="group" aria-label="What a change goes on">
      <button type="button" data-scope="one" class="${o.scope !== 'all' ? 'on' : ''}"${o.canOne ? '' : ' disabled title="It has no node id: a change goes on every use"'}>This one</button>
      <button type="button" data-scope="all" class="${o.scope === 'all' ? 'on' : ''}" title="Every use of ${name}">Every ${name}</button>
    </div>
    ${sec('Typography', st.text ? dial('size', 'Size', now('size', st.text.size), 'size', { changed: changed('size') }) + dial('weight', 'Weight', now('weight', st.text.weight), 'weight', { changed: changed('weight') }) : '')}
    ${sec('Space around', around)}
    ${sec(ar ? 'Padding' : 'Spacing', spacing + gap)}
    ${sec('Shape', dial('radius', 'Radius', now('radius', radius), 'radius', { changed: changed('radius') }))}
    ${sec('Color', (st.text ? colour('Text', st.color, l.tokens) : '') + colour('Fill', st.fill, l.tokens) + colour('Stroke', st.stroke, l.tokens))}
    <div class="ds-bar">
      <button type="button" class="ds-icon" data-remove${n ? '' : ' disabled'} title="${n ? `Undo this part's ${n} change${n === 1 ? '' : 's'}` : 'No changes to undo'}" aria-label="Undo this part's changes">${ICON.undo}</button>
      ${l.item ? `<button type="button" class="ds-icon" data-library="${esc(l.item.id)}" title="Open ${esc(l.item.name)} in the Library" aria-label="Open in the Library">${ICON.book}</button>` : ''}
      <span class="ds-where${o.busy ? ' busy' : ''}" title="${esc(o.where || '')}">${o.busy ? 'Saving…' : esc(o.whereShort || '')}</span>
    </div>
  </section>`;
}
