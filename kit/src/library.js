// Library, the second tab of the panel at the left: every component the app
// is built from, and everywhere it's used, from library.py's scan of the
// app's files (GET /playground/library). Part of the prototype-playground kit.
//
// - The list: the components with an entry in the project's library folder,
//   approved, then pending, then drafts; then what's drawn without an entry
//   yet; the primitives; and the raw colours (where a token should be) by
//   file. Each says how often it's used, and marks what's out of step: a
//   screen's own copy of a part, or a copy, built from different parts than
//   the part is (it may still look the same), and look-alikes. Find a component narrows it.
// - Click one to open its page between the panels, where Files' reader opens:
//   what it's for and its rules, what draws it on each platform, its axes,
//   tokens and lineage, and its uses by screen. A screen, or a use, goes there
//   in the app and rings what it is, putting the page away so the app shows
//   (its row in the list brings it back); a file opens in Files' reader.
// - It scans again when the tab opens, after files change while it's open,
//   and with ↻.
// - Each component has a picture, so it's known at a glance: whenever a
//   screen is on show, the app cuts one of each component on it from one
//   drawing of the page (once a session), kept in playground/thumbs/_library/.
//   Take pictures visits the screens with components still without one, and
//   comes back.
// - A component's page shows it side by side as the app sets it up: the
//   named states its entry lists, and up to a dozen different set-ups from
//   its real uses (library.py's specimens), each drawn on its own by the
//   app's own code (the bridge's draw). Click one to see it in place.
// - And its explorations: a component exploration's versions change it
//   wherever the app draws it (new.py --component). They're in Explorations
//   on every screen it's on; here, Try runs one.

const getJSON = (url) => fetch(url, { cache: 'no-store' }).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `The server said ${r.status}.`);
  return body;
});
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const STATUS = [['approved', 'Approved'], ['pending', 'Pending'], ['draft', 'Drafts']];
const RESCAN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3.2H9.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// A path another project's (../Other/…) can't be read here; the reader reads only this one.
const inProject = (p) => typeof p === 'string' && p && !p.startsWith('..') && !p.startsWith('/');

// "has V15Icon ×3 instead of Icon ×4": what a copy or override holds that its part doesn't.
const diffText = (d) => {
  if (!d) return '';
  const list = (o) => Object.entries(o || {}).map(([k, v]) => `${k} ×${v}`).join(', ');
  return `has ${list(d.adds) || 'nothing more'} instead of ${list(d.drops) || 'nothing'}`;
};
const KIND = { instance: 'Instance', override: 'Its own copy', copy: 'Copy', 'look-alike': 'Look-alike' };

export class LibraryView {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.data = null;
    this.error = null;
    this.find = '';
    this.page = null; // the id of the component whose page is open
    this.tried = new Set(); // '<screen>/<id>': pictured (or looked for) this session
    this.drawn = new Map(); // id → {shots, failed, error}: its specimens, drawn by the app

    el.innerHTML = `
      <div class="pg-head">${hooks.head || '<h2>Library</h2>'}
        <button type="button" class="pg-locate" data-rescan aria-label="Scan again" title="Scan the app's files again">${RESCAN}</button>
        <button type="button" class="pg-min" data-close aria-label="Minimise the panel" title="Minimise (P)">‹</button></div>
      <div class="f-tools"><input type="search" placeholder="Find a component" aria-label="Find a component" spellcheck="false"></div>
      <div class="f-summary l-summary"></div>
      <div class="l-pics" hidden></div>
      <div class="l-list" role="list" aria-label="The components"></div>`;
    this.summaryEl = el.querySelector('.l-summary');
    this.picsEl = el.querySelector('.l-pics');
    this.picsEl.addEventListener('click', (e) => { if (e.target.closest('[data-take]')) this.takeAll(); });
    this.list = el.querySelector('.l-list');
    this.search = el.querySelector('input');
    el.querySelector('[data-close]').addEventListener('click', () => hooks.toggle?.());
    el.querySelector('[data-rescan]').addEventListener('click', () => this.load(true));
    this.search.addEventListener('input', () => { this.find = this.search.value.trim().toLowerCase(); this.draw(); });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.search.value) { e.preventDefault(); e.stopPropagation(); this.search.value = ''; this.find = ''; this.draw(); }
    });
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-item]');
      if (row) { this.open(row.dataset.item); return; }
      const file = e.target.closest('[data-file]');
      if (file) hooks.openFile(file.dataset.file);
    });

    this.reader = document.createElement('section');
    this.reader.className = 'pg-reader l-page';
    this.reader.setAttribute('aria-label', 'Component');
    this.reader.hidden = true;
    document.getElementById('workspace')?.append(this.reader);
    this.reader.addEventListener('click', (e) => this.onPage(e));
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.reader.hidden && !e.defaultPrevented && !document.querySelector('dialog[open]')) this.close();
    });
  }

  // ---- The scan --------------------------------------------------------------------

  async load(force = false) {
    if (this.loading || (!force && this.data && Date.now() - this.at < 1500)) return;
    this.loading = true;
    this.el.querySelector('[data-rescan]').classList.add('spin');
    try {
      this.data = await getJSON('/playground/library');
      this.error = null;
      this.drawn.clear(); // the code may have changed: draw the specimens again
      this.hooks.onLoad?.();
      this.at = Date.now();
    } catch (e) {
      this.error = e.message;
    } finally {
      this.loading = false;
      this.el.querySelector('[data-rescan]').classList.remove('spin');
    }
    this.draw();
    if (this.page) this.drawPage();
  }

  items() {
    const d = this.data;
    return d ? [...d.entries, ...d.unlisted] : [];
  }

  itemOf(id) { return this.items().find((x) => x.id === id) || null; }

  // ---- The list --------------------------------------------------------------------

  draw() {
    if (this.error) { this.summaryEl.textContent = ''; this.list.innerHTML = `<p class="l-note">${esc(this.error)}</p>`; return; }
    const d = this.data;
    if (!d) { this.list.innerHTML = '<p class="l-note">Scanning the app’s files…</p>'; return; }
    if (!d.configured) {
      this.summaryEl.textContent = '';
      this.list.innerHTML = '<p class="l-note">There’s no <code>"library"</code> in <code>playground/playground.json</code> yet, so nothing is scanned. The README’s “The component library” says how to add one.</p>';
      return;
    }
    const hit = (x) => !this.find || [x.name, x.id, ...(x.names || []), x.for || ''].some((t) => String(t).toLowerCase().includes(this.find));
    const out = [];
    for (const [status, title] of STATUS) {
      const group = d.entries.filter((e) => (e.status || 'draft') === status && hit(e));
      if (group.length) out.push(`<h4>${title}</h4><div class="l-rows">${group.map((e) => this.rowHTML(e, true)).join('')}</div>`);
    }
    const proposed = (d.proposed || []).filter(hit);
    if (proposed.length) {
      out.push(`<h4>Proposed by versions</h4><div class="l-rows">${proposed.map((p) => `
        <button type="button" class="l-row" data-file="${esc(p.file)}" title="Read its entry: Commit moves it into the library as a draft when its version is picked">
          <span class="l-thumb"><span class="l-dot s-proposed"></span></span>
          <span class="l-name"><b>${esc(p.name)}</b><small>${esc(p.version.replace('/', ' › '))}${p.for ? ` · ${esc(p.for)}` : ''}</small></span></button>`).join('')}</div>`);
    }
    const unlisted = d.unlisted.filter(hit);
    if (unlisted.length) out.push(`<h4>No entry yet</h4><div class="l-rows">${unlisted.map((u) => this.rowHTML(u, false)).join('')}</div>`);
    const prims = Object.entries(d.primitives || {}).filter(([n]) => !this.find || n.toLowerCase().includes(this.find));
    if (prims.length) out.push(`<h4>Primitives</h4><p class="l-prims">${prims.map(([n, c]) => `<span>${esc(n)} <small>${c}</small></span>`).join('')}</p>`);
    if (d.raw?.length && !this.find) {
      out.push(`<h4>Raw colours</h4><div class="l-rows">${d.raw.map((r) => `
        <button type="button" class="l-row" data-file="${esc(r.file)}" title="Open ${esc(r.file)}">
          <span class="l-swatch" style="background:${esc(r.sample)}"></span>
          <span class="l-name"><b>${esc(r.file.split('/').pop())}</b><small>${esc(r.file)}</small></span>
          <span class="l-flag amber">${r.count}</span></button>`).join('')}</div>`);
    }
    if (!out.length) out.push(`<p class="l-note">Nothing matches “${esc(this.find)}”.</p>`);
    const keep = this.list.scrollTop;
    this.list.innerHTML = out.join('');
    this.list.scrollTop = keep;
    const raw = (d.raw || []).reduce((n, r) => n + r.count, 0);
    this.drawPics();
    this.summaryEl.textContent = [`${d.entries.length} with an entry`, `${d.unlisted.length} without`, raw ? plural(raw, 'raw colour') : ''].filter(Boolean).join(' · ');
  }

  rowHTML(x, listed) {
    const c = x.counts;
    const where = x.screens.length ? ` · ${plural(x.screens.length, 'screen')}` : '';
    const flags = [
      c.differ ? `<span class="l-flag amber" title="Copies built from different parts than it (they may still look the same)">${c.differ} differ</span>` : '',
      x.lookalikes?.length ? `<span class="l-flag" title="Drawn by something else that looks like it">${plural(x.lookalikes.length, 'look-alike')}</span>` : '',
      !listed ? `<span class="l-kind">${x.kind === 'part' ? 'part' : 'renderer'}</span>` : '',
    ].join('');
    return `<button type="button" class="l-row${this.page === x.id ? ' sel' : ''}" data-item="${esc(x.id)}" title="${esc(x.for || x.name)}">
      <span class="l-thumb">${this.imgHTML(x)}${listed ? `<span class="l-dot s-${esc(x.status)}" title="${esc(x.status)}"></span>` : ''}</span>
      <span class="l-name"><b>${esc(x.name)}</b><small>${plural(c.uses, 'use')}${where}</small></span>${flags}</button>`;
  }

  // ---- A component's page ----------------------------------------------------------

  open(id) {
    const first = this.reader.hidden || this.page !== id;
    this.page = id;
    this.hooks.onOpen?.();
    this.drawPage(first);
    this.draw();
  }

  close() {
    this.reader.hidden = true;
    this.page = null;
    this.draw();
  }

  drawPage(first = false) {
    const x = this.itemOf(this.page);
    if (!x) { this.close(); return; }
    const e = x.entry || null, c = x.counts;
    const chips = [
      e ? `<span class="r-chip s-${esc(x.status)}">${esc(x.status)}</span>` : '<span class="r-chip">No entry yet</span>',
      `<span>${plural(c.uses, 'use')}${x.screens.length ? ` on ${plural(x.screens.length, 'screen')}` : ''}</span>`,
      c.overrides ? `<span class="r-chip">${plural(c.overrides, 'own copy', 'own copies')}</span>` : '',
      c.copies ? `<span class="r-chip m-amber">${plural(c.copies, 'copy', 'copies')}</span>` : '',
      c.differ ? `<span class="r-chip m-amber" title="Built from different parts than the shared one; they may still look the same">${c.differ} built differently</span>` : '',
      x.lookalikes?.length ? `<span class="r-chip m-amber">${plural(x.lookalikes.length, 'look-alike')}</span>` : '',
    ].join('');
    const sections = [];
    if (e?.purpose) {
      const p = e.purpose;
      sections.push(`<section><h3>What it’s for</h3>${p.for ? `<p>${esc(p.for)}</p>` : ''}${p.notFor ? `<p class="l-not"><b>Not for:</b> ${esc(p.notFor)}</p>` : ''}
        ${p.rules?.length ? `<ul>${p.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}</section>`);
    } else if (!e) {
      const name = String(x.id).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
      sections.push(`<section><p class="l-not">Nothing says what this is yet. Add <code>${esc(this.data.dir)}/${esc(name)}.json</code> with its purpose, axes and the code that draws it, and it joins the library as a draft.</p></section>`);
    }
    sections.push(this.specimensHTML(x));
    sections.push(this.explorationsHTML(x));
    sections.push(this.whereHTML(x));
    const impl = e?.implementations || {};
    if (Object.keys(impl).length || x.main.length) {
      const rows = Object.entries(impl).map(([platform, i]) => {
        const by = i.renderer || i.part || i.widget || '';
        const file = i.file && (i.project ? `${i.project}/${i.file}` : i.file);
        return `<tr><td>${esc(platform)}</td><td><code>${esc(by)}</code>${i.contract ? ` <small>${esc(i.contract)}</small>` : ''}</td>
          <td>${file ? this.fileHTML(file) : ''}${(i.lookalikes || []).map((l) => `<div class="l-look">Look-alike: ${esc(l)}</div>`).join('')}</td></tr>`;
      });
      for (const m of x.main) if (!Object.values(impl).some((i) => i.part === m.part)) rows.push(`<tr><td>part</td><td><code>${esc(m.part)}</code></td><td>${this.fileHTML(m.file)}</td></tr>`);
      sections.push(`<section><h3>Drawn by</h3><table class="l-table">${rows.join('')}</table></section>`);
    }
    if (e?.axes?.length) {
      sections.push(`<section><h3>Axes</h3><table class="l-table">${e.axes.map((a) => `<tr><td>${esc(a.name)}</td><td>${
        a.kind === 'enum' ? (a.values || []).map((v) => `<code>${esc(v)}</code>`).join(' ')
        : `${esc(a.kind)}${a.range ? ` ${esc(a.range.from)} to ${esc(a.range.to)}` : ''}${a.unit ? ` ${esc(a.unit)}` : ''}${a.law ? `, by ${esc(a.law)}` : ''}`
      }${a.about ? `<div class="l-look">${esc(a.about)}</div>` : ''}</td></tr>`).join('')}</table></section>`);
    }
    if (e?.tokens && Object.keys(e.tokens).length) {
      sections.push(`<section><h3>Tokens</h3><table class="l-table">${Object.entries(e.tokens).map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(v)}</code></td></tr>`).join('')}</table></section>`);
    }
    if (e?.behaviour) {
      const b = e.behaviour;
      sections.push(`<section><h3>Behaviour</h3><table class="l-table">
        ${b.reads?.length ? `<tr><td>Reads</td><td>${b.reads.map(esc).join(', ')}</td></tr>` : ''}
        ${b.writes?.length ? `<tr><td>Writes</td><td>${b.writes.map(esc).join(', ')}</td></tr>` : ''}
        ${Object.entries(b.gestures || {}).map(([g, what]) => `<tr><td>${esc(g)}</td><td>${esc(what)}</td></tr>`).join('')}
        ${b.flutterContract ? `<tr><td>Flutter</td><td><code>${esc(b.flutterContract)}</code></td></tr>` : ''}</table></section>`);
    }
    if (e?.lineage) {
      const l = e.lineage, rows = [];
      for (const a of l.adaptedFrom || []) rows.push(`<tr><td>Adapted from</td><td>${esc([a.system, a.id, a.what].filter(Boolean).join(': '))}</td></tr>`);
      for (const a of l.inspiredBy || []) rows.push(`<tr><td>Inspired by</td><td>${esc(a.what)}${a.where ? `<div>${this.fileHTML(a.where)}</div>` : ''}</td></tr>`);
      if (l.figma) rows.push(`<tr><td>Figma</td><td>${esc([l.figma.file, l.figma.node].filter(Boolean).join(' · '))}${l.figma.about ? `<div class="l-look">${esc(l.figma.about)}</div>` : ''}</td></tr>`);
      if (l.history) rows.push(`<tr><td>History</td><td>${esc(l.history)}</td></tr>`);
      if (rows.length) sections.push(`<section><h3>Where it came from</h3><table class="l-table">${rows.join('')}</table></section>`);
    }
    const keep = first ? 0 : this.reader.querySelector('.r-body')?.scrollTop || 0;
    this.reader.innerHTML = `
      <div class="r-head"><span class="l-dot ${e ? `s-${esc(x.status)}` : 'none'}"></span><span class="r-title"><b>${esc(x.name)}</b><small>${esc(x.file || x.names.join(', '))}</small></span>
        ${x.file ? `<button type="button" data-file="${esc(x.file)}" title="Read its entry in Files' reader">Open entry</button>` : ''}
        <button type="button" data-ring title="Ring it on the screen on show">Show on screen</button>
        <button type="button" class="pg-min" data-close aria-label="Close the component" title="Close (Esc)">×</button></div>
      <div class="r-meta">${chips}</div>
      <div class="r-body">${this.heroHTML(x)}<div class="l-body">${sections.join('')}</div></div>`;
    this.reader.querySelector('.r-body').scrollTop = keep;
    this.reader.hidden = false;
    if (first) { this.reader.classList.remove('enter'); void this.reader.offsetWidth; this.reader.classList.add('enter'); }
    this.drawSpecimens(x);
  }

  // ---- Its explorations ----------------------------------------------------------------

  explorationsHTML(x) {
    const pgs = this.hooks.explorations?.(x.id) || [];
    const start = `<code>python3 playground/new.py --component ${esc(x.id)} "Name"</code>`;
    if (!pgs.length) {
      return `<section><h3>Explorations</h3><p class="l-look">None yet. A component exploration changes it wherever the app draws it, on every screen at once. Ask Claude for one, or run ${start}.</p></section>`;
    }
    const rows = pgs.flatMap((pg) => pg.versions.filter((v) => v.id !== 'default').map((v) => {
      const on = this.hooks.trying(pg) === v.id ? ' · being tried' : this.hooks.picked(pg) === v.id ? ' · the pick' : '';
      return `<tr><td><button type="button" class="l-go" data-try="${esc(v.id)}" data-pg="${esc(pg.id)}" title="Try it: it runs on every screen">${esc(this.hooks.versionName(pg, v.id))}</button></td>
        <td>${esc(v.note || '')}<small>${esc(on)}</small></td></tr>`;
    }));
    return `<section><h3>Explorations</h3><p class="l-look">Each changes it wherever the app draws it. They’re in Explorations on every screen it’s on.</p>
      ${rows.length ? `<table class="l-table">${rows.join('')}</table>` : ''}<p class="l-look">Another: ${start}.</p></section>`;
  }

  // ---- Specimens: the component side by side, drawn by the app ---------------------

  whereName(w) {
    return !w ? '' : w.startsWith('part ') ? `in the part ${w.slice(5)}` : this.hooks.screenTitle(w);
  }

  // A specimen's set-up, short: its first few props ("level -10 · selected true").
  propsText(node) {
    const p = node.props || node.with || {};
    const text = Object.entries(p).slice(0, 4).map(([k, v]) => `${k} ${v !== null && typeof v === 'object' ? '…' : String(v)}`).join(' · ');
    return text.length > 70 ? `${text.slice(0, 69)}…` : text;
  }

  specimensHTML(x) {
    if (!x.specimens?.length) return '';
    const got = this.drawn.get(x.id), known = new Set(this.data.screens || []);
    if (got?.error) return `<section><h3>As used</h3><p class="l-look">The app can’t draw components on their own: ${esc(got.error)}</p></section>`;
    const tile = (sp, i) => {
      const png = got?.shots?.[i], why = got?.failed?.[i];
      const title = sp.name || [this.whereName(sp.where), sp.own ? 'its own copy' : ''].filter(Boolean).join(' · ');
      const props = this.propsText(sp.node);
      const go = !sp.name && known.has(sp.where);
      const node = sp.id || sp.node.id;
      const wide = sp.size[0] / sp.size[1] > 3;
      return `<figure class="l-spec${go ? ' go' : ''}${wide ? ' wide' : ''}"${go ? ` data-go="${esc(sp.where)}"${node ? ` data-node="${esc(String(node))}"` : ''} title="See it in place on ${esc(title)}"` : ''}>
        <div class="l-spec-img">${png ? `<img src="data:image/png;base64,${png}" alt="">` : why ? `<span>${esc(why)}</span>` : '<span class="l-wait">Drawing…</span>'}</div>
        <figcaption><b>${esc(title)}</b>${props ? `<small>${esc(props)}</small>` : ''}<small>${Math.round(sp.size[0])} × ${Math.round(sp.size[1])}</small></figcaption></figure>`;
    };
    const all = x.specimens.map((sp, i) => [sp, i]);
    const states = all.filter(([sp]) => sp.name), used = all.filter(([sp]) => !sp.name);
    return (states.length ? `<section><h3>States</h3><div class="l-specs">${states.map(([sp, i]) => tile(sp, i)).join('')}</div></section>` : '')
      + (used.length ? `<section><h3>As used</h3><p class="l-look">The different ways the app sets it up, each drawn on its own by the app’s code. What one reads from the app (a level, a name) is the app’s value now, so it can be empty or odd away from its screen. Click one to see it in place.</p>
        <div class="l-specs">${used.map(([sp, i]) => tile(sp, i)).join('')}</div></section>` : '');
  }

  // Asks the app to draw the component's specimens, once per scan.
  async drawSpecimens(x) {
    if (!x.specimens?.length || this.drawn.has(x.id)) return;
    this.drawn.set(x.id, { shots: {}, failed: {} });
    try {
      const r = await this.hooks.draw(x.specimens.map((sp, i) => ({ key: String(i), node: sp.node, size: sp.size })), 2);
      this.drawn.set(x.id, r);
    } catch (e) {
      this.drawn.set(x.id, { error: e.message });
    }
    if (this.page === x.id && !this.reader.hidden) this.drawPage();
  }

  fileHTML(path) {
    return inProject(path) ? `<button type="button" class="l-file" data-file="${esc(path)}" title="Read it in Files' reader">${esc(path)}</button>` : `<code>${esc(path)}</code>`;
  }

  // Its uses: by screen (a button that goes there), the shared parts it's
  // in, the source files that place it; then each use that's out of step.
  whereHTML(x) {
    const known = new Set(this.data.screens || []);
    const screens = x.screens.filter((s) => known.has(s));
    const rows = screens.map((s) => `<tr><td><button type="button" class="l-go" data-go="${esc(s)}" title="Go there and ring it">${esc(this.hooks.screenTitle(s))}</button></td>
      <td>${x.byWhere[s] ? plural(x.byWhere[s], 'use') : '<span class="l-look">through a shared part</span>'}</td></tr>`);
    for (const [w, n] of Object.entries(x.byWhere)) {
      if (known.has(w)) continue;
      const part = w.startsWith('part ') ? w.slice(5) : null;
      const file = part ? x.uses.find((u) => u.where === w)?.file : w;
      rows.push(`<tr><td>${part ? `In the part <code>${esc(part)}</code>` : 'In code'}${file ? `<div>${this.fileHTML(file)}</div>` : ''}</td><td>${plural(n, 'use')}</td></tr>`);
    }
    const odd = x.uses.filter((u) => u.kind !== 'instance' || u.differs);
    const oddRows = odd.map((u) => `<tr><td>${esc(KIND[u.kind] || u.kind)}${u.kind === 'look-alike' ? ` <code>${esc(u.name)}</code>` : ''}</td>
      <td>${known.has(u.where) ? `<button type="button" class="l-go" data-go="${esc(u.where)}"${u.node ? ` data-node="${esc(u.node)}"` : ''}>${esc(this.hooks.screenTitle(u.where))}</button>` : this.fileHTML(u.file)}
        ${u.node ? ` <small>${esc(u.node)}</small>` : ''}${u.line ? ` <small>line ${u.line}</small>` : ''}
        ${u.differs ? `<div class="l-diff">${esc(diffText(u.differs))}</div>` : ''}</td></tr>`);
    const more = x.usesTotal > x.uses.length ? `<p class="l-look">Showing ${x.uses.length} of ${x.usesTotal} uses.</p>` : '';
    return `<section><h3>Where it’s used</h3>${rows.length ? `<table class="l-table">${rows.join('')}</table>` : '<p class="l-look">Nowhere the scan looks.</p>'}
      ${oddRows.length ? `<h3>Out of step</h3><table class="l-table">${oddRows.join('')}</table>` : ''}${more}</section>`;
  }

  async onPage(e) {
    if (e.target.closest('[data-close]')) { this.close(); return; }
    const t = e.target.closest('[data-try]');
    if (t) {
      const pg = this.hooks.explorations(this.itemOf(this.page)?.id).find((p) => p.id === t.dataset.pg);
      if (pg) { this.reader.hidden = true; await this.hooks.tryVersion(pg, t.dataset.try); }
      return;
    }
    const shoot = e.target.closest('[data-shoot]');
    if (shoot) { await this.takeOne(this.itemOf(this.page)); return; }
    const file = e.target.closest('[data-file]');
    if (file) { this.hooks.openFile(file.dataset.file); return; }
    const go = e.target.closest('[data-go]');
    if (go || e.target.closest('[data-ring]')) await this.ring(go?.dataset.go, go?.dataset.node);
  }

  // What the app looks for to find a component: its renderers by name, and by
  // node id its shared parts and their uses (on the screen, if one is given).
  query(x, screen, node) {
    const parts = new Set(x.main.map((m) => m.part));
    return {
      components: x.names.filter((n) => !parts.has(n)),
      nodes: [...new Set([...(node ? [node] : []), ...x.main.flatMap((m) => m.roots),
        ...x.uses.filter((u) => parts.has(u.name) && u.node && (!screen || u.where === screen)).map((u) => u.node)])],
    };
  }

  // ---- Pictures ----------------------------------------------------------------------

  imgHTML(x) {
    return x.picture ? `<img src="/playground/thumbs/_library/${encodeURIComponent(x.id)}.png?${x.picture.at}" alt="" loading="lazy">` : '';
  }

  heroHTML(x) {
    const screens = x.screens.filter((s) => (this.data.screens || []).includes(s));
    if (x.picture) {
      const from = x.picture.screen ? `On ${esc(this.hooks.screenTitle(x.picture.screen))}` : 'Taken';
      return `<figure class="l-hero"><div class="l-hero-img">${this.imgHTML(x)}</div>
        <figcaption>${from} · ${esc(new Date(x.picture.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
        ${screens.length ? '<button type="button" class="l-go" data-shoot>Take it again</button>' : ''}</figcaption></figure>`;
    }
    return `<figure class="l-hero empty"><div class="l-hero-img"><span>${screens.length ? 'No picture yet' : 'No picture: it isn’t on a screen the playground knows'}</span></div>
      ${screens.length ? `<figcaption>It’s taken when ${esc(this.hooks.screenTitle(screens[0]))}${screens.length > 1 ? ' or another screen it’s on' : ''} is on show. <button type="button" class="l-go" data-shoot>Take it now</button></figcaption>` : ''}</figure>`;
  }

  drawPics() {
    const missing = this.items().filter((x) => !x.picture && x.screens.some((s) => (this.data.screens || []).includes(s)));
    this.picsEl.hidden = !missing.length && !this.taking;
    this.picsEl.innerHTML = this.taking ? `<span>${esc(this.taking)}</span>`
      : `<span>${plural(missing.length, 'component')} without a picture</span><button type="button" class="l-go" data-take title="Visit each screen they're on, picture them, and come back">Take pictures</button>`;
  }

  // The screen on show changed: picture what's on it, once it has settled.
  onScreen(screen) {
    clearTimeout(this.shotT);
    if (this.taking || this.noPictures) return;
    this.shotT = setTimeout(async () => {
      if (!this.data) await this.load();
      if (this.hooks.route()?.screen === screen) await this.pictureScreen(screen);
    }, 1800);
  }

  // Pictures every component on the screen on show that hasn't one from this
  // session (or each listed in only), and keeps them.
  async pictureScreen(screen, only = null, again = false) {
    if (!this.data || this.noPictures) return 0;
    const items = (only || this.items()).filter((x) => x.screens.includes(screen) && (again || !this.tried.has(`${screen}/${x.id}`)));
    if (!items.length) return 0;
    let shots;
    try {
      shots = await this.hooks.picture(items.map((x) => ({ key: x.id, ...this.query(x, screen) })), 320);
    } catch {
      this.noPictures = true; // a bridge without pictures: stop asking this session
      return 0;
    }
    for (const x of items) this.tried.add(`${screen}/${x.id}`);
    let saved = 0;
    for (const [id, png] of Object.entries(shots)) {
      try {
        const r = await fetch('/playground/thumbs', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'thumbs' },
          body: JSON.stringify({ component: id, screen, png }),
        });
        const x = this.itemOf(id);
        if (r.ok && x) { x.picture = { at: Date.now(), screen }; saved++; }
      } catch {}
    }
    if (saved) { this.draw(); if (this.page && !this.reader.hidden) this.drawPage(); }
    return saved;
  }

  // Visits each screen with components still without a picture, takes them,
  // and goes back to the screen you were on.
  async takeAll() {
    if (this.taking || !this.data) return;
    this.noPictures = false;
    const known = new Set(this.data.screens || []);
    const missing = this.items().filter((x) => !x.picture);
    const screens = [...new Set(missing.flatMap((x) => x.screens.filter((s) => known.has(s))))];
    const back = this.hooks.route()?.screen;
    let done = 0, saved = 0;
    try {
      for (const s of screens) {
        this.taking = `Taking pictures: ${this.hooks.screenTitle(s)} (${++done} of ${screens.length})…`;
        this.drawPics();
        if (!await this.hooks.visit(s)) continue;
        await new Promise((ok) => setTimeout(ok, 700));
        saved += await this.pictureScreen(s, missing.filter((x) => !x.picture), true);
        if (this.noPictures) break;
      }
    } finally {
      this.taking = null;
      if (back) await this.hooks.visit(back);
      this.draw();
    }
    const left = this.items().filter((x) => !x.picture && x.screens.some((s) => known.has(s))).length;
    this.hooks.toast(this.noPictures ? 'The app can’t take pictures of components: its bridge may be older than the kit (setup.py --update).'
      : `Took ${plural(saved, 'picture')}.${left ? ` ${left} weren’t in view on their screens (a part of the screen that isn’t open).` : ''}`);
  }

  // One component's picture: on the screen on show if it's there, else on the
  // first of its screens, coming back after.
  async takeOne(x) {
    if (!x) return;
    const known = new Set(this.data.screens || []);
    const here = this.hooks.route()?.screen;
    const screens = x.screens.filter((s) => known.has(s));
    const target = screens.includes(here) ? here : screens[0];
    if (!target) return;
    this.noPictures = false;
    if (target !== here && !await this.hooks.visit(target)) { this.hooks.toast(`The app didn’t go to ${this.hooks.screenTitle(target)}.`); return; }
    if (target !== here) await new Promise((ok) => setTimeout(ok, 700));
    const saved = await this.pictureScreen(target, [x], true);
    if (target !== here && here) await this.hooks.visit(here);
    if (!saved) this.hooks.toast(this.noPictures ? 'The app can’t take pictures of components: its bridge may be older than the kit (setup.py --update).'
      : `It isn’t in view on ${this.hooks.screenTitle(target)}: it may be in a part of the screen that isn’t open.`);
  }

  // Goes to the screen (or stays on the one on show) and rings the component
  // there: by its renderers' names, and by node id for its shared parts and
  // the use clicked.
  async ring(screen, node) {
    const x = this.itemOf(this.page);
    if (!x) return;
    const { nodes, components } = this.query(x, screen, node);
    const title = screen ? this.hooks.screenTitle(screen) : 'the screen on show';
    this.reader.hidden = true; // the page covers the app; its row stays selected
    try {
      const n = await this.hooks.locate({ screen, nodes, components });
      if (n < 0) this.hooks.toast(`The app didn’t go to ${title}.`);
      else if (!n) this.hooks.toast(`None in view on ${title}: it may be in a part of the screen that isn’t open.`);
    } catch (err) {
      this.hooks.toast(`The app can’t point at components: ${err.message} Its bridge may be older than the kit (setup.py --update).`);
    }
  }
}
