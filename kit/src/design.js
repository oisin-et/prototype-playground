// Design, in the canvas's Properties (src/panels.js): the look of the part
// picked with Inspect, value by value, against the project's design system
// (system.py, "system" in playground.json). Part of the prototype-playground
// kit.
//
// Each value is matched to the system's scale for it: type size, weight,
// corner radius, spacing (padding and gaps), colour. A value on the scale is
// named by its step; one that isn't is marked: amber when it's still on the
// project's grid ("grid": 4), red when it's off both. Each row shows the
// scale as a dial, one dot a step, the step in use filled. The dials only show
// for now: changing a value comes next.

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

// One row: its name, the dial (the scale's steps up to the value's
// neighbourhood), and the value with its step.
function row(label, v, scale, { grid, unit = 'px', special } = {}) {
  if (v == null) return '';
  if (v === 0 && !special) special = 'None';
  if (special) return `<div class="ds-row"><span class="ds-label">${esc(label)}</span><span class="ds-dial"></span><span class="ds-val ok">${esc(special)}</span></div>`;
  const m = match(scale, v, grid);
  if (!m) return `<div class="ds-row"><span class="ds-label">${esc(label)}</span><span class="ds-dial"></span><span class="ds-val">${esc(v)}${unit}</span></div>`;
  const top = Math.max(v, ...(scale.length <= 8 ? scale.map((x) => x.value) : [64]));
  const steps = scale.filter((x) => x.value <= top || x === m.step).slice(0, 14);
  const on = m.step || m.near;
  const dial = steps.map((x) => `<i class="${x === on ? (m.state === 'ok' ? 'on' : `near ${m.state}`) : ''}" title="${esc(x.name)} · ${esc(x.value)}${unit}"></i>`).join('');
  const val = m.state === 'ok' ? `<b>${esc(m.step.name)}</b> ${esc(v)}${unit}`
    : `${esc(v)}${unit}<small>${m.state === 'grid' ? `on the ${grid} px grid, not a step` : 'off the scale'} · nearest ${esc(m.near.name)} ${esc(m.near.value)}</small>`;
  return `<div class="ds-row" data-state="${m.state}"><span class="ds-label">${esc(label)}</span><span class="ds-dial">${dial}</span><span class="ds-val ${m.state}">${val}</span></div>`;
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
 * Inspect: { component, pg, box, style, tokens, item }), at (the one shown).
 */
export function designHTML(levels, at) {
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
  const radius = st.radius == null ? null : st.radius;
  const minSide = Math.min(st.width || bw || 0, st.height || bh || 0);
  const radiusSpecial = radius === 0 ? 'Square' : radius != null && minSide && radius >= minSide / 2 - 0.5 ? 'Pill' : null;
  const pad = st.padding || [];
  const spacing = [
    row('Padding top', pad[0], s.space, { grid }), row('Right', pad[1], s.space, { grid }),
    row('Bottom', pad[2], s.space, { grid }), row('Left', pad[3], s.space, { grid }),
    ...(st.gap ? [st.gap[0] === st.gap[1] || !st.gap[1] ? row('Gap', st.gap[0], s.space, { grid })
      : row('Gap, rows', st.gap[0], s.space, { grid }) + row('Gap, columns', st.gap[1], s.space, { grid })] : []),
  ].join('');
  const sections = [
    st.text ? `<h5>Typography</h5>${row('Size', st.text.size, s.type)}${row('Weight', st.text.weight, s.weight, { unit: '' })}` : '',
    `<h5>Spacing</h5>${spacing}`,
    `<h5>Shape</h5>${row('Radius', radius, s.radius, { special: radiusSpecial })}${row('Width', st.width ?? bw, null, { grid })}${row('Height', st.height ?? bh, null, { grid })}`,
    `<h5>Colour</h5>${st.text ? colourRow('Text', st.color, l.tokens) : ''}${colourRow('Fill', st.fill, l.tokens)}${colourRow('Stroke', st.stroke, l.tokens)}`,
  ].join('');
  const off = (sections.match(/data-state="(off|grid)"/g) || []).length;
  return `<section class="ds"><h4>Design <small>${esc(system.name)}${system.modes?.Grid ? ` · ${esc(system.modes.Grid)}` : ''}</small></h4>
    <div class="ds-path">${path}</div>
    <p class="ds-sum ${off ? 'off' : 'ok'}">${off ? `${off} value${off === 1 ? '' : 's'} not on ${esc(system.name)}'s steps` : `Every value is one of ${esc(system.name)}'s steps`}</p>
    ${sections}
    ${l.item ? `<button type="button" class="ds-lib" data-library="${esc(l.item.id)}">Open ${esc(l.item.name)} in the Library</button>` : ''}
  </section>`;
}
