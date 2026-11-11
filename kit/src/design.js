// Design, in the canvas's Properties (src/panels.js): the look of the part
// picked with Inspect, value by value, against the project's design system
// (system.py, "system" in playground.json). Part of the prototype-playground
// kit.
//
// Each value is matched to the system's scale for it: type size, weight,
// corner radius, spacing (padding and gaps), colour. A value on the scale is
// named by its step; one that isn't is marked: amber when it's still on the
// project's grid ("grid": 4), red when it's off both. Each row shows the
// scale as a dial, one dot a step, the step in use filled.
//
// A dot is a button: a click sets that step on the part and saves it at once
// in the frame's iteration (system.py's design.json, which the app's bridge
// lays over the app), or, on Main, in a new exploration. A saved row is
// marked. A change goes on this part, or on every use of its component.
// Colours only show for now.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

let system = null, loading = null;
// The system's scales, once: { name, grid, scales: { type, weight, radius, space, color } }.
export const loadSystem = () => (loading ??= fetch('/playground/system', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : {})).catch(() => ({})).then((s) => { system = s; return s; }));

const hex = (css) => {
  const m = String(css || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
  if (!m) return /^#/.test(css || '') ? css.toLowerCase() : null;
  const a = m[4] === undefined ? 1 : +m[4];
  if (a === 0) return 'none';
  const h = '#' + [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return a < 1 ? h + Math.round(a * 255).toString(16).padStart(2, '0') : h;
};

// A number against a scale: { state: 'ok' | 'grid' | 'off', step, near }.
function match(scale, v, grid) {
  if (v == null || !scale?.length) return null;
  const step = scale.find((x) => Math.abs(x.value - v) < 0.5);
  if (step) return { state: 'ok', step };
  const near = scale.reduce((a, b) => (Math.abs(b.value - v) < Math.abs(a.value - v) ? b : a));
  return { state: grid && Math.abs(v / grid - Math.round(v / grid)) < 0.01 ? 'grid' : 'off', near };
}

// What each dial sets, as a style property and its value.
export const PILL = 9999;
const CSS = {
  size: 'fontSize', weight: 'fontWeight', radius: 'borderRadius', gap: 'gap', rowGap: 'rowGap', columnGap: 'columnGap',
  pt: 'paddingTop', pr: 'paddingRight', pb: 'paddingBottom', pl: 'paddingLeft',
};
export const cssOf = (prop, v) => [CSS[prop], prop === 'weight' ? String(v) : `${v}px`];

// One row: its name, the dial (the scale's steps up to the value's
// neighbourhood; each a button when the row has a prop), and the value with
// its step. changed: the value is a saved change.
function row(label, v, scale, { grid, unit = 'px', prop, zero, changed } = {}) {
  if (v == null) return '';
  const m = match(scale, v, grid);
  const lab = `<span class="ds-label">${esc(label)}${changed ? '<i class="ds-changed" title="Changed with the dials, saved"></i>' : ''}</span>`;
  if (!m) return `<div class="ds-row">${lab}<span class="ds-dial"></span><span class="ds-val">${v === 0 && zero ? esc(zero) : `${esc(v)}${unit}`}</span></div>`;
  const nameOf = (x) => (x.value === 0 && zero ? zero : x.name);
  const shown = (x) => (x.value === PILL ? '' : ` ${x.value}${unit}`);
  const top = Math.max(v === PILL ? 0 : v, ...(scale.length <= 8 ? scale.map((x) => x.value) : [64]));
  const steps = scale.filter((x) => x.value <= top || x === m.step).slice(0, 14);
  const on = m.step || m.near;
  const dot = (x) => {
    const cls = x === on ? (m.state === 'ok' ? 'on' : `near ${m.state}`) : '';
    const title = `${esc(nameOf(x))}${esc(shown(x))}`;
    return prop ? `<button type="button" class="ds-dot ${cls}" data-prop="${prop}" data-value="${esc(x.value)}" title="${title}" aria-label="${esc(label)}: ${title}"></button>`
      : `<i class="${cls}" title="${title}"></i>`;
  };
  const val = m.state === 'ok' ? `<b>${esc(nameOf(m.step))}</b>${esc(m.step.value === 0 && zero ? '' : shown(m.step))}`
    : `${esc(v)}${unit}<small>${m.state === 'grid' ? `on the ${grid} px grid, not a step` : 'off the scale'} · nearest ${esc(nameOf(m.near))}${esc(shown(m.near))}</small>`;
  return `<div class="ds-row${changed ? ' changed' : ''}" data-state="${m.state}">${lab}<span class="ds-dial">${steps.map(dot).join('')}</span><span class="ds-val ${m.state}">${val}</span></div>`;
}

// The system's colour with the same red, green and blue at another opacity:
// the one whose name shares most words with the app's token, if it has one.
const words = (t) => String(t || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);
const alike = (h, own) => {
  const same = (system?.scales?.color || []).filter((x) => String(x.value).toLowerCase().slice(0, 7) === h.slice(0, 7));
  const mine = new Set(words(own));
  const score = (x) => words(x.token).filter((w) => mine.has(w)).length;
  return same.sort((a, b) => score(b) - score(a))[0] || null;
};
// A colour: the system's tokens with that value, else the app's own token, else off.
function colourRow(label, css, tokens) {
  const h = hex(css);
  if (!h) return '';
  if (h === 'none') return `<div class="ds-row"><span class="ds-label">${esc(label)}</span><span class="ds-dial"></span><span class="ds-val">None</span></div>`;
  const named = (system?.scales?.color || []).filter((x) => String(x.value).toLowerCase() === h);
  const own = (tokens || []).find((t) => hex(t.value) === h);
  const like = named.length ? null : alike(h, own?.name);
  const state = named.length ? 'ok' : 'off';
  const name = named.length ? `<b>${esc(named[0].name)}</b>${named.length > 1 ? `<small>also ${esc(named.slice(1, 3).map((x) => x.name).join(', '))}</small>` : ''}`
    : `${esc(h)}<small>not one of ${esc(system?.name || 'the system')}'s colours${like ? ` · ${esc(like.name)} is ${esc(like.value)}` : ''}</small>`;
  return `<div class="ds-row" data-state="${state}"><span class="ds-label">${esc(label)}</span><span class="ds-swatch" style="background:${esc(h)}"></span>
    <span class="ds-val ${state}">${name}${own ? `<small>app token ${esc(own.name.replace(/^--/, ''))}</small>` : ''}</span></div>`;
}

/**
 * The Design section for a picked part: levels (innermost first, from
 * Inspect: { component, pg, box, style, tokens, item }), at (the one shown),
 * and o: { dials (its saved changes: {prop: value}), scope ('one' | 'all'),
 * canOne (it has a node id), where (where changes save), busy }.
 */
export function designHTML(levels, at, o = {}) {
  const changes = o.dials || {};
  const l = levels?.[at];
  if (!l) return '';
  const s = system?.scales || {}, grid = system?.grid, st = l.style || {};
  const [, , bw, bh] = l.box || [];
  const path = levels.map((x, i) => ({ x, i })).reverse()
    .map(({ x, i }) => `<button type="button" class="ds-crumb${i === at ? ' on' : ''}" data-level="${i}">${esc(x.item?.name || x.component)}</button>`).join('<span>›</span>');
  if (!system?.scales) {
    return `<section class="ds"><h4>Design</h4><div class="ds-path">${path}</div>
      <p class="cv-pnone">${system?.error ? esc(system.error) : 'No design system is named for this project: add "system" to playground.json.'}</p></section>`;
  }
  const now = (prop, measured) => (prop in changes ? changes[prop] : measured);
  const opt = (prop, more = {}) => ({ grid, prop, changed: prop in changes, ...more });
  const minSide = Math.min(st.width || bw || 0, st.height || bh || 0);
  const measuredRadius = st.radius == null ? null : minSide && st.radius >= minSide / 2 - 0.5 && st.radius > 0 ? PILL : st.radius;
  const radii = [{ name: 'Square', value: 0 }, ...(s.radius || []), { name: 'Pill', value: PILL }];
  const pad = st.padding || [];
  const sp = (label, prop, v) => row(label, now(prop, v), s.space, opt(prop, { zero: 'None' }));
  const gap = st.gap;
  const spacing = [
    sp('Padding top', 'pt', pad[0]), sp('Right', 'pr', pad[1]), sp('Bottom', 'pb', pad[2]), sp('Left', 'pl', pad[3]),
    ...(gap ? [gap[0] === gap[1] || !gap[1] ? sp('Gap', 'gap', gap[0]) : sp('Gap, rows', 'rowGap', gap[0]) + sp('Gap, columns', 'columnGap', gap[1])] : []),
  ].join('');
  const sections = [
    st.text ? `<h5>Typography</h5>${row('Size', now('size', st.text.size), s.type, opt('size'))}${row('Weight', now('weight', st.text.weight), s.weight, opt('weight', { unit: '' }))}` : '',
    `<h5>Spacing</h5>${spacing}`,
    `<h5>Shape</h5>${row('Radius', now('radius', measuredRadius), radii, opt('radius'))}${row('Width', st.width ?? bw, null, { grid })}${row('Height', st.height ?? bh, null, { grid })}`,
    `<h5>Colour</h5>${st.text ? colourRow('Text', st.color, l.tokens) : ''}${colourRow('Fill', st.fill, l.tokens)}${colourRow('Stroke', st.stroke, l.tokens)}`,
  ].join('');
  const off = (sections.match(/data-state="(off|grid)"/g) || []).length;
  const n = Object.keys(changes).length;
  return `<section class="ds"><h4>Design <small>${esc(system.name)}${system.modes?.Grid ? ` · ${esc(system.modes.Grid)}` : ''}</small></h4>
    <div class="ds-path">${path}</div>
    <p class="ds-sum ${off ? 'off' : 'ok'}">${off ? `${off} value${off === 1 ? '' : 's'} not on ${esc(system.name)}'s steps` : `Every value is one of ${esc(system.name)}'s steps`}</p>
    <div class="ds-scope" role="group" aria-label="What a change goes on">
      <button type="button" data-scope="one" class="${o.scope !== 'all' ? 'on' : ''}"${o.canOne ? '' : ' disabled title="It has no node id: a change goes on every use"'}>This one</button>
      <button type="button" data-scope="all" class="${o.scope === 'all' ? 'on' : ''}">Every ${esc(l.item?.name || l.component)}</button></div>
    <div class="ds-preview${o.busy ? ' busy' : ''}"><span>${o.busy ? 'Saving…' : esc(o.where || '')}</span>${n ? `<button type="button" data-remove title="Take this part's saved changes out">Remove ${n} change${n === 1 ? '' : 's'}</button>` : ''}</div>
    ${sections}
    ${l.item ? `<button type="button" class="ds-lib" data-library="${esc(l.item.id)}">Open ${esc(l.item.name)} in the Library</button>` : ''}
  </section>`;
}
