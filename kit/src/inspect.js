// Inspect, the playground's dev mode: with it on (the Inspect button in the
// bar, or I), the app doesn't take the pointer. Hovering it outlines the
// library component under the pointer and says what it is, in a card beside
// it: its picture, name and status, what kind of use it is (an instance, a
// screen's own copy of a part, a copy, a look-alike or a primitive), the
// parts it sits in, its size, the tokens its drawing uses (with their
// values) and any colour written out instead of a token. ↑ and ↓ move out to
// the part it's in and back in. A click opens its page in the Library (on the
// canvas, hooks.pick: it picks the part, for Properties' Design). I or
// Esc stops; it and note mode turn each other off. Part of the
// prototype-playground kit.
//
// The app's bridge names what's under the pointer (hooks.inspect with
// library: each element with data-component around it, innermost first);
// the Library's scan says what each one is (library.js).

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
// "{c}" in a node id stands for any value, as in a repeated template's.
const idPattern = (id) => new RegExp(`^${String(id).split(/\{\w+\}/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*?')}$`);
const matches = (pattern, id) => !!pattern && !!id && idPattern(pattern).test(id);
const KIND = {
  instance: 'Instance', override: 'This screen’s own copy of it', copy: 'A copy, not an instance',
  'look-alike': 'Look-alike', primitive: 'Primitive', unknown: 'Not in the scan',
};

export const mountInspect = ({ library, hooks, open, onStart }) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pg-inspect-btn';
  btn.textContent = 'Inspect';
  btn.title = 'Hover the app to see which component each part is (I)';
  btn.setAttribute('aria-pressed', 'false');
  const subbar = document.getElementById('subbar');
  (subbar?.querySelector('.spacer') ? subbar.querySelector('.spacer').before(btn) : subbar?.append(btn));
  const outline = document.createElement('div');
  outline.className = 'pg-ibox';
  outline.hidden = true;
  const card = document.createElement('div');
  card.className = 'pg-icard';
  card.hidden = true;
  card.setAttribute('role', 'status');
  document.body.append(outline, card);

  let on = false, levels = [], at = 0, key = '', asking = false, next = null;

  const hide = () => { outline.hidden = true; card.hidden = true; levels = []; key = ''; };
  const set = (v) => {
    if (v === on) return;
    on = v;
    document.body.classList.toggle('pg-inspecting', on);
    btn.setAttribute('aria-pressed', String(on));
    if (on) { onStart?.(); library.load(); } else hide();
  };
  btn.addEventListener('click', () => set(!on));

  // What each component around the point is, by the Library's scan: a shared
  // part by its node id (and whether this screen has its own copy), else an
  // entry by the name that draws it (or a look-alike of one), else a
  // component with no entry yet, else a primitive.
  const identify = (chain) => {
    const items = library.items(), screen = hooks.route()?.screen;
    const prims = new Set(Object.keys(library.data?.primitives || {}));
    const entries = library.data?.entries || [];
    return chain.map((c) => {
      let item = null, kind = null;
      if (c.pg) {
        for (const x of items) {
          const copy = x.uses.find((u) => u.kind === 'copy' && u.where === screen && matches(u.node, c.pg));
          if (copy) { item = x; kind = 'copy'; break; }
          if (x.main.some((m) => m.roots.some((r) => matches(r, c.pg)))) {
            item = x;
            kind = x.uses.some((u) => u.kind === 'override' && u.where === screen) ? 'override' : 'instance';
            break;
          }
        }
      }
      if (!item) {
        item = entries.find((e) => e.names.includes(c.component)) || null;
        if (item) kind = 'instance';
        else if ((item = entries.find((e) => e.lookalikes?.some((l) => l.name === c.component)) || null)) kind = 'look-alike';
        else if ((item = items.find((x) => x.id === c.component) || null)) kind = 'instance';
        else kind = prims.has(c.component) ? 'primitive' : 'unknown';
      }
      return { ...c, item, kind };
    });
  };
  const worth = (l) => l.kind !== 'primitive' && l.kind !== 'unknown';
  const nameOf = (l) => (l.kind === 'look-alike' ? l.component : l.item?.name || l.component);

  const draw = () => {
    const l = levels[at];
    if (!l) { hide(); return; }
    const r = l.rect;
    Object.assign(outline.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    outline.className = `pg-ibox k-${l.kind}`;
    outline.hidden = false;
    const x = l.item, entry = x?.entry;
    const status = entry ? `<span class="pg-istatus s-${esc(x.status)}">${esc(x.status)}</span>` : x ? '<span class="pg-istatus">no entry yet</span>' : '';
    const kind = l.kind === 'look-alike' ? `Look-alike of ${esc(x.name)}` : KIND[l.kind];
    // The parts it sits in, outermost first; the one shown is bold.
    const path = levels.map((p, i) => ({ p, i })).filter(({ p, i }) => worth(p) || i === at).reverse()
      .map(({ p, i }) => (i === at ? `<b>${esc(nameOf(p))}</b>` : esc(nameOf(p)))).join(' › ');
    const [, , w, h] = l.box || [0, 0, 0, 0];
    card.innerHTML = `
      <div class="pg-ihead"><span class="l-thumb">${x ? library.imgHTML(x) : ''}</span>
        <span class="pg-iname"><b>${esc(nameOf(l))}</b><small>${kind}${status ? ' · ' : ''}${status}</small></span></div>
      ${x?.for ? `<p class="pg-ifor">${esc(x.for)}</p>` : ''}
      <div class="pg-irow">${path}</div>
      <div class="pg-irow dim">${Math.round(w)} × ${Math.round(h)}${l.pg ? ` · <code>${esc(l.pg)}</code>` : ''} · drawn by <code>${esc(l.component)}</code></div>
      ${l.tokens?.length ? `<div class="pg-itokens">${l.tokens.map((t) => `<span title="${esc(t.value)}"><i style="background:${esc(t.value)}"></i>${esc(t.name.replace(/^--/, ''))}</span>`).join('')}</div>` : ''}
      ${l.raw?.length ? `<div class="pg-iraw">${l.raw.length === 1 ? 'A colour' : `${l.raw.length} colours`} not from a token: ${l.raw.map((c) => `<span><i style="background:${esc(c)}"></i>${esc(c)}</span>`).join('')}</div>` : ''}
      <div class="pg-ihint">${hooks.pick ? 'Click to see its design' : x ? 'Click to open it in the Library' : 'Nothing in the Library for this'}${levels.some((p, i) => i > at && worth(p)) ? ' · ↑ the part it’s in' : ''}${levels.some((p, i) => i < at && worth(p)) ? ' · ↓ back in' : ''}</div>`;
    card.hidden = false;
    // Beside the outline: under it if there's room, else over it, kept on the page.
    const cw = card.offsetWidth, ch = card.offsetHeight;
    let left = Math.min(Math.max(8, r.left), innerWidth - cw - 8);
    let top = r.bottom + 10;
    if (top + ch > innerHeight - 8) top = r.top - ch - 10;
    if (top < 8) top = Math.min(innerHeight - ch - 8, Math.max(8, r.top + 10));
    Object.assign(card.style, { left: `${left}px`, top: `${top}px` });
  };

  // One question to the app at a time, the latest point asked again once
  // it's answered (as note mode does).
  const ask = async (x, y) => {
    next = { x, y };
    if (asking) return;
    asking = true;
    while (next) {
      const p = next;
      next = null;
      const hit = await hooks.inspect(p.x, p.y, true).catch(() => null);
      if (!on) break;
      const chain = hit?.chain || [];
      if (!chain.length) { hide(); continue; }
      const found = identify(chain);
      const k = found.map((l) => l.pg || l.component).join('|');
      levels = found;
      if (k !== key) { key = k; at = Math.max(0, found.findIndex(worth)); }
      draw();
    }
    asking = false;
  };

  const over = (e) => on && !e.altKey && !['pg-space', 'pg-alt', 'pg-aiming'].some((c) => document.body.classList.contains(c)) && !!e.target.closest?.('.pg-shield');
  addEventListener('pointermove', (e) => { if (over(e)) ask(e.clientX, e.clientY); else if (on) hide(); }, true);
  addEventListener('pointerdown', (e) => { if (over(e) && e.button === 0) { e.preventDefault(); e.stopPropagation(); } }, true);
  addEventListener('click', (e) => {
    if (!over(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const l = levels[at];
    if (l && hooks.pick) hooks.pick(levels, at);
    else if (l?.item) open(l.item.id);
    else if (l) hooks.toast(`${l.component} isn’t in the Library’s scan.`);
  }, true);
  document.querySelector('.pg-shield')?.addEventListener('pointerleave', () => { if (on) hide(); });
  addEventListener('keydown', (e) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'i' || e.key === 'I') { e.preventDefault(); set(!on); return; }
    if (!on) return;
    if (e.key === 'Escape' && library.reader.hidden) { set(false); return; }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && levels.length) {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 1 : -1;
      for (let i = at + step; i >= 0 && i < levels.length; i += step) if (worth(levels[i])) { at = i; draw(); break; }
    }
  });
  // The page under the outline may move (the canvas pans or zooms): let go.
  addEventListener('wheel', () => { if (on) hide(); }, { passive: true, capture: true });

  return { set, identify, get on() { return on; } };
};
