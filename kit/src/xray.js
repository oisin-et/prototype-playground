// X-ray (src/canvas.js): hold ⇧ and drag over a live frame, or arm it from
// the frame toolbar. Part of the prototype-playground kit. After Gridray.
//
// The app's bridge lists every element in the area (`xray`); this draws them
// over the frame: the area hatched, each element that holds nothing else
// lit with a sheen and its size, and the space around things as dashed lines
// with their numbers: a container's padding (from its edge to what it holds)
// and the gaps between neighbours. Every number is in the app's own pixels
// (its CSS pixels, below any scale), and counts up to its value. The drawing
// is in the frame's pixels, so it pans and zooms with the frame. It stays
// until Esc, a click on the canvas, or the next drag.
//
// No label covers another: each goes where it has room on screen, in order
// (the area's size, then padding, then gaps, then sizes, the largest first),
// and a line whose number has no room isn't drawn. Zoom in to see more.

const MAX_LABELS = 70;

/**
 * o: { stage, frames, W, ask(f, message, wait), toast(text), shield(on), changed() }
 */
export function mountXray(o) {
  let shift = false, armed = false, drag = null, shown = null; // shown: { f, el }
  let asking = false, again = null;
  const values = new Map(); // a label's key → the number it shows, so a new drawing counts on from it

  const active = () => shift || armed;
  const set = () => {
    o.stage.classList.toggle('xraying', active() || !!drag);
    o.shield(active() || !!drag);
    o.changed();
  };
  const frameAt = (cx, cy) => o.frames.find((f) => {
    if (!f.ready) return false;
    const b = f.iframe.getBoundingClientRect();
    return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
  });
  const toFrame = (f, cx, cy) => {
    const b = f.iframe.getBoundingClientRect(), k = b.width / o.W;
    return [(cx - b.left) / k, (cy - b.top) / k];
  };

  // ---- The drag ----
  o.stage.addEventListener('pointerdown', (e) => {
    if (!active() || e.button !== 0 || e.altKey) return;
    const f = frameAt(e.clientX, e.clientY);
    if (!f) { if (armed) o.toast('X-ray: drag over a live frame.'); return; }
    e.stopImmediatePropagation();
    e.preventDefault();
    const [x, y] = toFrame(f, e.clientX, e.clientY);
    drag = { f, x0: x, y0: y, x1: x, y1: y };
    try { o.stage.setPointerCapture(e.pointerId); } catch {}
    set();
  }, true);
  o.stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    const [x, y] = toFrame(drag.f, e.clientX, e.clientY);
    drag.x1 = Math.max(0, Math.min(o.W, x));
    drag.y1 = Math.max(0, y);
    measure(drag.f, rectOf(drag));
  }, true);
  const up = (e) => {
    if (!drag) return;
    e.stopImmediatePropagation();
    const d = drag;
    drag = null;
    set();
    const r = rectOf(d);
    if (r.w < 4 || r.h < 4) { clear(); return; }
    measure(d.f, r);
  };
  o.stage.addEventListener('pointerup', up, true);
  o.stage.addEventListener('pointercancel', up, true);
  const rectOf = (d) => ({ x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) });

  // One question to the app at a time; the latest area is asked again once it answers.
  async function measure(f, r) {
    if (asking) { again = [f, r]; return; }
    asking = true;
    try {
      const m = await o.ask(f, { type: 'xray', rect: r }, 3000);
      draw(f, r, m.elements || []);
    } catch {
      o.toast("X-ray needs the playground's newer bridge in the app: run setup.py --update.");
    }
    asking = false;
    if (again) { const [g, s] = again; again = null; measure(g, s); }
  }

  // ---- The drawing ----
  function layer(f) {
    if (shown && shown.f !== f) clear();
    if (!shown) {
      const el = document.createElement('div');
      el.className = 'cv-xray';
      f.body.append(el);
      shown = { f, el };
    }
    return shown.el;
  }
  function clear() {
    shown?.el.remove();
    shown = null;
    values.clear();
  }

  function draw(f, r, els) {
    const el = layer(f);
    const inside = (x, y) => x >= r.x - 0.5 && x <= r.x + r.w + 0.5 && y >= r.y - 0.5 && y <= r.y + r.h + 0.5;
    const kids = els.map(() => []);
    els.forEach((e, i) => { if (e.parent >= 0) kids[e.parent].push(i); });
    const unit = (px, s) => Math.round(px / (s || 1));
    const scale = median(els.map((e) => e.s).filter(Boolean)) || 1;
    const parts = [];

    // The area: hatched, with its size below.
    parts.push(`<div class="cv-xsel" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"></div>`);
    parts.push(pill('size', 'sel', r.x + r.w / 2, r.y + r.h, [unit(r.w, scale), unit(r.h, scale)]));

    // What holds nothing else: lit with a sheen.
    const leaves = els.map((e, i) => i).filter((i) => !kids[i].length && overlaps(els[i].box, r));
    leaves.sort((a, b) => area(els[b].box) - area(els[a].box));
    for (const i of leaves.slice(0, 160)) {
      const [x, y, w, h] = clip(els[i].box, r);
      parts.push(`<div class="cv-xbox" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px"></div>`);
    }

    // The labels, in order, each where it has room: a label's size on
    // screen, in the frame's pixels (k: screen pixels per frame pixel).
    const k = f.iframe.getBoundingClientRect().width / o.W;
    const placed = [];
    const room = (x, y, text) => {
      const w = (text.length * 7.4 + 14) / k, h = 21 / k;
      const b = [x - w / 2 - 2 / k, y - h / 2 - 2 / k, w + 4 / k, h + 4 / k];
      if (placed.some((q) => b[0] < q[0] + q[2] && b[0] + b[2] > q[0] && b[1] < q[1] + q[3] && b[1] + b[3] > q[1])) return false;
      placed.push(b);
      return true;
    };
    const label = (kind, key, x, y, nums) => {
      if (placed.length >= MAX_LABELS || !room(x, y, nums.join(' × '))) return false;
      parts.push(pill(kind, key, x, y, nums));
      return true;
    };
    label('size', 'sel', r.x + r.w / 2, r.y + r.h, [unit(r.w, scale), unit(r.h, scale)]);

    // The space: each container's padding, and the gaps between neighbours.
    const pads = [], gaps = [];
    els.forEach((c, ci) => {
      const ks = kids[ci];
      if (!ks.length) return;
      const [x, y, w, h] = c.box, s = els[ks[0]].s || c.s;
      const u = union(ks.map((q) => els[q].box));
      const midY = u[1] + u[3] / 2, midX = u[0] + u[2] / 2;
      pads.push(['h', `p${ci}l`, x, u[0], midY, s]);
      pads.push(['h', `p${ci}r`, u[0] + u[2], x + w, midY, s]);
      pads.push(['v', `p${ci}t`, y, u[1], midX, s]);
      pads.push(['v', `p${ci}b`, u[1] + u[3], y + h, midX, s]);
      // Neighbours: the nearest to the right that shares some height, the nearest below that shares some width.
      for (const a of ks) {
        const A = els[a].box;
        let right = null, below = null;
        for (const b of ks) {
          if (a === b) continue;
          const B = els[b].box;
          const vShare = Math.min(A[1] + A[3], B[1] + B[3]) - Math.max(A[1], B[1]);
          const hShare = Math.min(A[0] + A[2], B[0] + B[2]) - Math.max(A[0], B[0]);
          const dx = B[0] - (A[0] + A[2]), dy = B[1] - (A[1] + A[3]);
          if (vShare > 1 && dx > 0.5 && (!right || dx < right[0])) right = [dx, B, Math.max(A[1], B[1]) + vShare / 2];
          if (hShare > 1 && dy > 0.5 && (!below || dy < below[0])) below = [dy, B, Math.max(A[0], B[0]) + hShare / 2];
        }
        if (right) gaps.push(['h', `g${a}r`, A[0] + A[2], right[1][0], right[2], els[a].s]);
        if (below) gaps.push(['v', `g${a}b`, A[1] + A[3], below[1][1], below[2], els[a].s]);
      }
    });
    for (const [dir, key, from, to, at, s] of [...pads, ...gaps]) {
      const v = unit(to - from, s);
      if (v < 1) continue;
      const mid = (from + to) / 2;
      const [px, py] = dir === 'h' ? [mid, at] : [at, mid];
      if (!inside(px, py) || !label('gap', key, px, py, [v])) continue;
      parts.push(dir === 'h'
        ? `<div class="cv-xline h" style="left:${from}px;top:${at}px;width:${to - from}px"></div>`
        : `<div class="cv-xline v" style="left:${at}px;top:${from}px;height:${to - from}px"></div>`);
    }

    // Sizes: the larger first.
    for (const i of leaves) {
      const [x, y, w, h] = els[i].box, s = els[i].s;
      const cx = x + w / 2, cy = y + h / 2;
      if (!inside(cx, cy) || w * k < 14 || h * k < 10) continue;
      label('size', `s${i}`, cx, cy, [unit(w, s), unit(h, s)]);
    }

    el.innerHTML = parts.join('');
    countUp(el);
  }

  // A number's label: it counts up from what it showed before (or from 0).
  function pill(kind, key, x, y, nums) {
    return `<span class="cv-xpill ${kind}" style="left:${x}px;top:${y}px">${nums.map((v, i) => {
      const k = `${key}.${i}`;
      const from = values.get(k) ?? 0;
      values.set(k, v);
      return `<b data-from="${from}" data-to="${v}">${from}</b>`;
    }).join(' × ')}</span>`;
  }
  function countUp(el) {
    const nums = [...el.querySelectorAll('[data-to]')].filter((b) => b.dataset.from !== b.dataset.to);
    if (!nums.length) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { for (const b of nums) b.textContent = b.dataset.to; return; }
    const t0 = performance.now(), T = 420;
    const tick = () => {
      const t = Math.min(1, (performance.now() - t0) / T), e = 1 - (1 - t) ** 3;
      for (const b of nums) b.textContent = Math.round(+b.dataset.from + (+b.dataset.to - +b.dataset.from) * e);
      if (t < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ---- Keys: ⇧ held (here or in a frame), Esc ----
  const typing = (t) => t?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  addEventListener('keydown', (e) => {
    if (e.key === 'Shift' && !typing(e.target) && !e.repeat) { shift = true; set(); }
    else if (e.key === 'Escape' && (shown || armed)) { e.stopImmediatePropagation(); clear(); armed = false; set(); }
  }, true);
  addEventListener('keyup', (e) => { if (e.key === 'Shift') { shift = false; set(); } }, true);
  addEventListener('blur', () => { if (shift) { shift = false; set(); } });
  // A click on the canvas, away from a drag, puts the drawing away.
  o.stage.addEventListener('pointerdown', (e) => { if (!active() && shown && e.button === 0) clear(); });

  return {
    get armed() { return armed; },
    arm(on) { armed = on; if (!on) drag = null; set(); if (on) o.toast('X-ray: drag over a live frame. Hold ⇧ to x-ray any time.'); },
    shift(down) { shift = down; set(); },
    escape() { if (!shown && !armed) return false; clear(); armed = false; set(); return true; },
  };
}

const area = ([, , w, h]) => w * h;
const overlaps = ([x, y, w, h], r) => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y;
const clip = ([x, y, w, h], r) => {
  const l = Math.max(x, r.x), t = Math.max(y, r.y), rr = Math.min(x + w, r.x + r.w), b = Math.min(y + h, r.y + r.h);
  return [l, t, Math.max(0, rr - l), Math.max(0, b - t)];
};
const union = (boxes) => {
  const l = Math.min(...boxes.map((b) => b[0])), t = Math.min(...boxes.map((b) => b[1]));
  const r = Math.max(...boxes.map((b) => b[0] + b[2])), b = Math.max(...boxes.map((x) => x[1] + x[3]));
  return [l, t, r - l, b - t];
};
const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
