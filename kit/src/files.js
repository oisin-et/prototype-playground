// Files, the panel at the left of the canvas: the project's folder, one for
// one, the way VS Code's explorer shows it (after Studio's). Part of the
// prototype-playground kit.
//
// - On show: the files behind what's on the canvas: the file the screen on
//   show is drawn from, the folder of each version running on it, its
//   screen's versions.json, and the picks. They stay in their real folders,
//   and a folder with one folder inside shares its row, as VS Code does.
// - Changed: everything git sees changed since the last commit.
// - All files: the whole folder as it is on disk, folders first.
// - Find a file narrows any of them to the paths that hold every word typed.
//
// git's marks are on every row (M changed, U new, A added, D deleted, and a
// dot on a folder with changes inside), what git ignores is dimmed, and the
// playground's own files say what they are (a screen's name, a version's
// number and name). The panel asks serve.py again every few seconds
// (/playground/files/poll), so it follows the folder whoever changes it: a
// file that has just changed glows for a moment, and so do the folders above
// it, which is how Claude's work shows as it happens.
//
// Click a file to read it: the reader opens between the panels, as Studio's
// does, and follows the file as it changes. The arrows, Enter and Space work as in any tree.

import { md } from './md.js';

const INDENT = 12;
const FIND_MAX = 400;
const POLL = 2500;
const FRESH = 4000; // how long a changed file glows

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p) => p.slice(p.lastIndexOf('/') + 1);
const cmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const ancestors = (p) => { const out = []; let q = p.replace(/\/$/, ''); while (q.includes('/')) { q = parentOf(q); out.push(q); } return out; };
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const getJSON = (url) => fetch(url, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// ---- Icons ------------------------------------------------------------------------

const svg = (body) => `<svg viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`;
const ICON = {
  chevron: svg('<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>'),
  folder: svg('<path d="M1.5 4.2c0-.6.5-1.2 1.2-1.2h3.4l1.5 1.6h5.7c.6 0 1.2.5 1.2 1.2v6.5c0 .6-.5 1.2-1.2 1.2H2.7c-.6 0-1.2-.5-1.2-1.2z" fill="currentColor"/>'),
  folderOpen: svg('<path d="M1.5 4.2c0-.6.5-1.2 1.2-1.2h3.4l1.5 1.6h4.8c.6 0 1.2.5 1.2 1.2V6H4.4c-.5 0-.9.3-1.1.8L1.5 12z" fill="currentColor" opacity=".7"/><path d="M3.4 7.2c.2-.5.6-.8 1.1-.8h10c.4 0 .7.4.6.8l-1.6 5c-.2.5-.6.8-1.1.8H1.9z" fill="currentColor"/>'),
  file: svg('<path d="M4 1.8h5.2L12.5 5v8.5c0 .4-.3.7-.7.7H4c-.4 0-.7-.3-.7-.7V2.5c0-.4.3-.7.7-.7z M9 2v3.2h3.3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="6" cy="6.6" r="1.2" fill="currentColor"/><path d="M2.8 12l3.6-3.6 2.4 2.4 1.8-1.8 2.6 2.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>'),
  playground: svg('<rect x="1.8" y="1.8" width="12.4" height="12.4" rx="3.2" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="5.2" y="5.2" width="5.6" height="5.6" rx="1.4" fill="currentColor"/>'),
  collapse: svg('<rect x="2.5" y="2.5" width="11" height="11" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>'),
  editor: svg('<path d="M9 2.5h4.5V7M13.3 2.7L7.5 8.5M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>'),
};

// A glyph and a colour per kind of file, after VS Code's default icons.
const TYPES = [
  [/\.(md|markdown|mdx)$/i, 'M', 'blue'],
  [/\.(json|jsonc)$/i, '{}', 'amber'],
  [/\.(m?js|cjs|jsx)$/i, 'JS', 'yellow'],
  [/\.tsx?$/i, 'TS', 'blue'],
  [/\.dart$/i, '◆', 'teal'],
  [/\.py$/i, 'py', 'blue'],
  [/\.html?$/i, '<>', 'orange'],
  [/\.(css|scss)$/i, '#', 'blue'],
  [/\.[ch]$/i, 'C', 'purple'],
  [/\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i, ICON.image, 'purple'],
  [/\.svg$/i, ICON.image, 'amber'],
  [/\.(ya?ml|toml|lock)$/i, '≡', 'purple'],
  [/\.(otf|ttf|woff2?)$/i, 'Aa', 'red'],
  [/\.(sh|zsh|command)$/i, '$', 'green'],
  [/^\.git(ignore|attributes|keep)$|^\.vercelignore$/i, '◇', 'muted'],
];
const iconOf = (path, dir = false, open = false) => {
  if (dir) return `<span class="ficon folder">${open ? ICON.folderOpen : ICON.folder}</span>`;
  if (path === 'playground/playground.json') return `<span class="ficon t-accent">${ICON.playground}</span>`;
  const name = nameOf(path);
  for (const [re, glyph, tone] of TYPES) {
    if (!re.test(name)) continue;
    return glyph.startsWith('<') ? `<span class="ficon t-${tone}">${glyph}</span>` : `<span class="ficon glyph t-${tone}">${esc(glyph)}</span>`;
  }
  return `<span class="ficon t-muted">${ICON.file}</span>`;
};

// git's two-letter code (`git status --porcelain`) as VS Code shows it.
const decode = (code) => {
  if (code === '??') return ['U', 'green', 'New, not in git yet'];
  if (/U|AA|DD/.test(code)) return ['!', 'red', 'In conflict'];
  if (code.includes('D')) return ['D', 'red', 'Deleted'];
  if (code[0] === 'R') return ['R', 'green', 'Renamed'];
  if (code[0] === 'A') return ['A', 'green', 'Added'];
  return ['M', 'amber', 'Changed since the last commit'];
};
const RANK = { red: 3, amber: 2, green: 1 };

// Wraps each word found in `name` in a <mark>.
const highlight = (name, terms) => {
  const lower = name.toLowerCase(), spans = [];
  for (const t of terms) { const i = lower.indexOf(t); if (i >= 0) spans.push([i, i + t.length]); }
  if (!spans.length) return esc(name);
  spans.sort((a, b) => a[0] - b[0]);
  let out = '', at = 0;
  for (const [a, b] of spans) {
    if (a < at) continue;
    out += esc(name.slice(at, a)) + `<mark>${esc(name.slice(a, b))}</mark>`;
    at = b;
  }
  return out + esc(name.slice(at));
};

const MODES = [['show', 'On show'], ['changed', 'Changed'], ['all', 'All files']];

// hooks: key (prefixes what's kept in this browser), onShow() → [{ path,
// label }] (a folder's path ends in "/"), describe() → Map of path → what it
// is, panel (the panel's element, for the reader to sit beside), toggle()
// (minimise the panel).
export class FilesView {
  constructor(el, hooks) {
    this.el = el;
    this.hooks = hooks;
    this.kids = new Map();       // folder → its entries, once listed
    this.loading = new Set();
    this.open = new Set(store.get(`${hooks.key}.files.open`, []));
    this.shut = new Set();       // folders closed in the narrowed trees, which start open
    this.mode = store.get(`${hooks.key}.files.mode`, 'show');
    if (!MODES.some(([m]) => m === this.mode)) this.mode = 'show';
    this.find = '';
    this.allFiles = null;
    this.selected = null;
    this.cursor = null;
    this.rows = [];
    this.fresh = new Map();      // path → when it last changed, while it glows
    this.root = '';
    this.setMarks({});

    el.innerHTML = `
      <div class="pg-head">${hooks.head || '<h2>Files</h2>'}
        <button type="button" class="pg-locate" data-collapse aria-label="Collapse all folders" title="Collapse all folders">${ICON.collapse}</button>
        <button type="button" class="pg-min" data-close aria-label="Minimise Files" title="Minimise (P)">‹</button></div>
      <div class="f-root"></div>
      <div class="f-mode pg-seg" role="tablist" aria-label="Which files">
        <span class="pg-seg-glider" aria-hidden="true"></span>
        ${MODES.map(([m, label]) => `<button type="button" role="tab" data-mode="${m}">${label}</button>`).join('')}
      </div>
      <div class="f-tools"><input type="search" placeholder="Find a file" aria-label="Find a file" spellcheck="false"></div>
      <div class="f-summary"></div>
      <div class="f-tree" role="tree" aria-label="The project's files"></div>`;
    this.rootEl = el.querySelector('.f-root');
    this.modeEl = el.querySelector('.f-mode');
    this.summaryEl = el.querySelector('.f-summary');
    this.search = el.querySelector('input');
    this.tree = el.querySelector('.f-tree');

    el.querySelector('[data-close]').addEventListener('click', () => hooks.toggle?.());
    el.querySelector('[data-collapse]').addEventListener('click', () => this.collapseAll());
    this.modeEl.addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) this.setMode(b.dataset.mode); });
    this.rootEl.addEventListener('click', (e) => { if (e.target.closest('[data-changed]')) this.setMode('changed'); });
    this.search.addEventListener('input', () => { this.find = this.search.value.trim(); this.draw(); });
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.setCursor(this.rows.findIndex((r) => !r.note), true); }
      if (e.key === 'Enter') { const r = this.rows.find((x) => !x.note && !x.dir); if (r) this.activate(r); }
      if (e.key === 'Escape' && this.search.value) { e.preventDefault(); e.stopPropagation(); this.search.value = ''; this.find = ''; this.draw(); }
    });
    this.tree.addEventListener('click', (e) => { const r = this.rowAt(e.target); if (r) { this.setCursor(this.rows.indexOf(r)); this.activate(r); } });
    this.tree.addEventListener('keydown', (e) => this.onKey(e));

    this.reader = new Reader(this);
    this.poll();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.poll(); });
  }

  // ---- Following the folder ------------------------------------------------------

  // git's marks, and every folder listed so far, again. A folder whose entries
  // changed is drawn again; a file whose time moved glows.
  async poll() {
    clearTimeout(this.pollT);
    if (document.hidden) return;
    const dirs = [...new Set(['', ...this.kids.keys(), ...(this.watch || [])])].slice(0, 400);
    try {
      const r = await getJSON(`/playground/files/poll?${dirs.map((d) => `d=${encodeURIComponent(d)}`).join('&')}`);
      this.root = r.root;
      const now = Date.now();
      let changed = false;
      const before = this.mk.raw || {};
      for (const [p, code] of Object.entries(r.marks.changes || {})) if (before[p] !== code && this.mk.raw) this.fresh.set(p.replace(/\/$/, ''), now);
      if (JSON.stringify(r.marks) !== JSON.stringify(this.marksRaw)) { this.marksRaw = r.marks; this.setMarks(r.marks); changed = true; }
      for (const d of dirs) {
        const next = r.dirs[d];
        const prev = this.kids.get(d);
        if (!next) { if (prev !== undefined) { this.kids.delete(d); changed = true; } continue; }
        if (JSON.stringify(next) === JSON.stringify(prev)) continue;
        if (prev) {
          const was = new Map(prev.map((e) => [e.path, e.mtime]));
          for (const e of next) if (!e.dir && was.get(e.path) !== e.mtime) this.fresh.set(e.path, now);
          this.allFiles = null;
        }
        this.kids.set(d, next);
        changed = true;
      }
      for (const [p, t] of this.fresh) if (now - t > FRESH) { this.fresh.delete(p); changed = true; }
      if (this.fresh.size) changed = true; // folders above a fresh file glow too, until it fades
      this.hooks.onFresh?.(this.fresh.size > 0);
      if (changed) this.draw();
      this.reader.follow();
    } catch {}
    this.pollT = setTimeout(() => this.poll(), this.fresh.size ? 1000 : POLL);
  }

  async load(folder) {
    if (this.loading.has(folder)) return;
    this.loading.add(folder);
    try { const r = await getJSON(`/playground/files/poll?d=${encodeURIComponent(folder)}`); this.kids.set(folder, r.dirs[folder] ?? null); } catch { this.kids.set(folder, null); }
    this.loading.delete(folder);
    this.draw();
  }

  setMarks(mk) {
    const files = new Map(), dirs = [], dirty = new Map(), ignored = new Set(), ignoredDirs = [];
    for (const [p, code] of Object.entries(mk.changes || {})) {
      const d = decode(code);
      if (p.endsWith('/')) dirs.push([p, d]); else files.set(p, d);
      for (const a of [p.replace(/\/$/, ''), ...ancestors(p)]) if (a !== p && (RANK[d[1]] || 0) > (RANK[dirty.get(a)] || 0)) dirty.set(a, d[1]);
    }
    for (const p of mk.ignored || []) if (p.endsWith('/')) ignoredDirs.push(p); else ignored.add(p);
    this.mk = { raw: mk.changes, repo: mk.repo, branch: mk.branch, files, dirs, dirty, ignored, ignoredDirs, count: Object.keys(mk.changes || {}).length };
  }

  markOf(p, isDir) {
    const own = this.mk.files.get(p) || this.mk.dirs.find(([pre]) => `${p}/`.startsWith(pre))?.[1];
    if (own) return { letter: own[0], tone: own[1], why: own[2] };
    if (isDir && this.mk.dirty.has(p)) return { dot: true, tone: this.mk.dirty.get(p), why: 'Has changes inside' };
    return null;
  }

  isIgnored(p) { return this.mk.ignored.has(p) || this.mk.ignoredDirs.some((pre) => `${p}/`.startsWith(pre)); }

  isFresh(p, isDir) {
    if (this.fresh.has(p)) return true;
    if (!isDir) return false;
    for (const f of this.fresh.keys()) if (f.startsWith(`${p}/`)) return true;
    return false;
  }

  // ---- Choosing ------------------------------------------------------------------

  setMode(m) {
    this.mode = m;
    store.set(`${this.hooks.key}.files.mode`, m);
    this.tree.scrollTop = 0;
    this.draw();
  }

  activate(r) {
    if (r.note) return;
    if (r.dir) { this.toggle(r); return; }
    this.selected = r.path;
    this.reader.show(r.path);
    this.draw();
  }

  // Which set says a folder is open: the whole folder's folders start shut;
  // the narrowed trees' start open. A folder from disk inside a narrowed tree
  // (a version's subfolder) goes by the whole folder's.
  narrowed(r) { return this.view() !== 'all' && !r.disk; }

  toggle(r) {
    if (this.narrowed(r)) { if (this.shut.has(r.path)) this.shut.delete(r.path); else this.shut.add(r.path); } else {
      if (this.open.has(r.path)) this.open.delete(r.path); else this.open.add(r.path);
      store.set(`${this.hooks.key}.files.open`, [...this.open]);
    }
    this.draw();
  }

  collapseAll() {
    if (this.view() === 'all') { this.open.clear(); store.set(`${this.hooks.key}.files.open`, []); } else for (const r of this.rows) if (r.dir) this.shut.add(r.path);
    this.tree.scrollTop = 0;
    this.draw();
  }

  // Shows a file in the whole folder, opening the folders above it.
  reveal(p) {
    this.selected = p;
    for (const a of ancestors(p)) this.open.add(a);
    store.set(`${this.hooks.key}.files.open`, [...this.open]);
    this.revealOnDraw = p;
    this.draw();
  }

  view() { return this.find ? 'find' : this.mode; }

  // ---- Drawing -------------------------------------------------------------------

  draw() {
    cancelAnimationFrame(this.drawF);
    this.drawF = requestAnimationFrame(() => this.drawNow());
  }

  drawNow() {
    if (this.el.closest('.min')) return;
    this.desc = this.hooks.describe?.() || new Map();
    this.drawRoot();
    this.drawMode();
    const v = this.view();
    let rows, summary = '';
    if (v === 'find') rows = this.rowsFind();
    else if (v === 'show') {
      const list = this.hooks.onShow?.() || [];
      this.showLabels = new Map(list.map((x) => [x.path.replace(/\/$/, ''), x.label]));
      rows = list.length ? this.rowsOf(list.map((x) => x.path)) : [{ note: 'Nothing on show yet: the app is starting.' }];
      summary = this.hooks.showSummary?.() || '';
    } else if (v === 'changed') {
      const paths = Object.keys(this.mk.raw || {});
      rows = !this.mk.repo ? [{ note: 'This folder isn\'t a git repo, so nothing is marked as changed.' }]
        : paths.length ? this.rowsOf(paths) : [{ note: 'Nothing has changed since the last commit.' }];
      summary = this.mk.repo ? `${paths.length} path${paths.length === 1 ? '' : 's'} changed since the last commit` : '';
    } else rows = this.rowsAll();
    this.summaryEl.textContent = summary;
    this.summaryEl.hidden = !summary;
    this.rows = rows;
    const hadFocus = this.tree.contains(document.activeElement);
    const keep = this.tree.scrollTop;
    this.tree.innerHTML = rows.map((r, i) => this.rowHTML(r, i)).join('');
    this.tree.scrollTop = keep;
    if (!rows.some((r) => r.path === this.cursor && !r.note)) this.cursor = rows.find((r) => r.path === this.selected)?.path || rows.find((r) => !r.note)?.path || null;
    const cur = this.rowElOf(this.cursor);
    if (cur) cur.tabIndex = 0;
    if (hadFocus) cur?.focus({ preventScroll: true });
    if (this.revealOnDraw) {
      const el = this.rowElOf(this.revealOnDraw);
      if (el) { el.scrollIntoView({ block: 'nearest' }); this.revealOnDraw = null; }
    }
  }

  drawMode() {
    for (const b of this.modeEl.querySelectorAll('[data-mode]')) {
      const on = b.dataset.mode === this.mode;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('on', on);
    }
    this.modeEl.classList.toggle('finding', !!this.find);
    const on = this.modeEl.querySelector('.on'), glider = this.modeEl.querySelector('.pg-seg-glider');
    if (on && on.offsetWidth) { glider.style.width = `${on.offsetWidth}px`; glider.style.transform = `translateX(${on.offsetLeft}px)`; }
  }

  drawRoot() {
    const name = this.root ? this.root.split('/').filter(Boolean).pop() : '';
    const { branch, count } = this.mk;
    this.rootEl.innerHTML = `<span class="f-name" title="${esc(this.root)}">${esc(name)}</span>
      ${branch ? `<span class="f-branch" title="On the branch ${esc(branch)}">${esc(branch)}</span>` : ''}
      ${count ? `<button type="button" class="f-changes" data-changed title="${count} path${count === 1 ? '' : 's'} changed since the last commit: show them">${count} changed</button>` : ''}`;
  }

  // The whole folder, as it is on disk, from `folder` down.
  visit(rows, folder, depth, extra = {}) {
    const kids = this.kids.get(folder);
    if (kids === undefined) { rows.push({ note: 'Loading…', depth }); this.load(folder); return; }
    if (kids === null) { rows.push({ note: 'Can\'t read this folder.', depth }); return; }
    if (!kids.length) { rows.push({ note: depth ? 'Empty' : 'The folder is empty.', depth }); return; }
    for (const e of kids) {
      const open = e.dir && this.open.has(e.path);
      rows.push({ ...e, depth, open, ...extra });
      if (open) this.visit(rows, e.path, depth + 1, extra);
    }
  }

  rowsAll() { const rows = []; this.visit(rows, '', 0); return rows; }

  // A tree of just these paths, in their folders, every folder open unless it
  // was closed here. A folder holding only one folder shares its row. A path
  // ending in "/" is a whole folder, listed from disk when it's open.
  rowsOf(paths, hl) {
    const root = { dirs: new Map(), files: [] };
    // Their folders are asked for with every poll, so a file in one glows when it changes.
    this.watch = new Set(paths.slice(0, 200).map((p) => (p.endsWith('/') ? p.slice(0, -1) : parentOf(p))));
    for (const raw of paths) {
      const whole = raw.endsWith('/'), p = raw.replace(/\/$/, '');
      const parts = p.split('/');
      let node = root, acc = '';
      for (const part of whole ? parts : parts.slice(0, -1)) {
        acc = acc ? `${acc}/${part}` : part;
        if (!node.dirs.has(part)) node.dirs.set(part, { path: acc, dirs: new Map(), files: [] });
        node = node.dirs.get(part);
      }
      if (whole) node.whole = true; else node.files.push(p);
    }
    const rows = [];
    const visit = (node, depth) => {
      for (let [name, d] of [...node.dirs].sort(([a], [b]) => cmp(a, b))) {
        while (!d.whole && !d.files.length && d.dirs.size === 1) { const [n2, d2] = [...d.dirs][0]; name = `${name}/${n2}`; d = d2; }
        const open = !this.shut.has(d.path);
        rows.push({ name, path: d.path, dir: true, depth, open });
        if (!open) continue;
        if (d.whole) this.visit(rows, d.path, depth + 1, { disk: true });
        else visit(d, depth + 1);
      }
      for (const p of node.files.sort((a, b) => cmp(nameOf(a), nameOf(b)))) rows.push({ name: nameOf(p), path: p, dir: false, depth, hl });
    };
    visit(root, 0);
    return rows;
  }

  rowsFind() {
    if (!this.allFiles) {
      if (!this.findLoading) {
        this.findLoading = getJSON('/playground/files/all').then((r) => { this.allFiles = r.files; }).catch(() => { this.allFiles = []; })
          .finally(() => { this.findLoading = null; this.draw(); });
      }
      return [{ note: 'Looking through the folder…' }];
    }
    const terms = this.find.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = this.allFiles.filter((p) => { const l = p.toLowerCase(); return terms.every((t) => l.includes(t)); });
    if (!hits.length) return [{ note: `No file matches "${this.find}".` }];
    const rows = this.rowsOf(hits.slice(0, FIND_MAX), terms);
    if (hits.length > FIND_MAX) rows.push({ note: `Showing ${FIND_MAX} of ${hits.length}. Type more to narrow it.` });
    return rows;
  }

  rowHTML(r, i) {
    if (r.note) return `<div class="frow note" style="padding-left:${8 + (r.depth || 0) * INDENT + 20}px">${esc(r.note)}</div>`;
    const mk = this.markOf(r.path, r.dir);
    const ignored = this.isIgnored(r.path);
    const desc = (this.view() === 'show' && this.showLabels?.get(r.path)) || this.desc.get(r.path);
    const sel = r.path === this.selected;
    const fresh = this.isFresh(r.path, r.dir);
    const title = [r.path, mk?.why, ignored ? 'Ignored by git' : null, fresh ? 'Just changed' : null].filter(Boolean).join(' · ');
    const cls = ['frow', r.dir && 'dir', r.open && 'open', ignored && 'ignored', mk && `m-${mk.tone}`, sel && 'sel', fresh && 'fresh'].filter(Boolean).join(' ');
    return `<div class="${cls}" role="treeitem" tabindex="-1" title="${esc(title)}" data-i="${i}" aria-level="${r.depth + 1}" aria-selected="${sel}"${r.dir ? ` aria-expanded="${!!r.open}"` : ''}>
      <span class="indent" style="width:${r.depth * INDENT}px"></span><span class="chev">${r.dir ? ICON.chevron : ''}</span>${iconOf(r.path, r.dir, r.open)}<span class="name">${r.hl ? highlight(r.name, r.hl) : esc(r.name)}</span>${desc ? `<span class="desc">${esc(desc)}</span>` : ''}${mk ? `<span class="mk">${mk.dot ? '•' : mk.letter}</span>` : ''}</div>`;
  }

  rowAt(target) {
    const el = target.closest?.('.frow[data-i]');
    return el ? this.rows[Number(el.dataset.i)] : null;
  }

  rowElOf(p) {
    if (p === null || p === undefined) return null;
    const i = this.rows.findIndex((r) => r.path === p && !r.note);
    return i >= 0 ? this.tree.querySelector(`.frow[data-i="${i}"]`) : null;
  }

  // ---- The keyboard ----------------------------------------------------------------

  setCursor(i, focus = false) {
    const r = this.rows[i];
    if (!r || r.note) return;
    this.rowElOf(this.cursor)?.setAttribute('tabindex', '-1');
    this.cursor = r.path;
    const el = this.rowElOf(r.path);
    if (!el) return;
    el.tabIndex = 0;
    if (focus) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }

  onKey(e) {
    const i = this.rows.findIndex((r) => r.path === this.cursor && !r.note);
    const r = this.rows[i];
    if (!r) return;
    const step = (from, dir) => { let j = from + dir; while (this.rows[j]?.note) j += dir; return this.rows[j] ? j : from; };
    switch (e.key) {
      case 'ArrowDown': this.setCursor(step(i, 1), true); break;
      case 'ArrowUp': if (i === this.rows.findIndex((x) => !x.note)) this.search.focus(); else this.setCursor(step(i, -1), true); break;
      case 'Home': this.setCursor(step(-1, 1), true); break;
      case 'End': this.setCursor(step(this.rows.length, -1), true); break;
      case 'ArrowRight': if (r.dir && !r.open) this.toggle(r); else if (r.dir) this.setCursor(step(i, 1), true); break;
      case 'ArrowLeft': {
        if (r.dir && r.open) { this.toggle(r); break; }
        let j = i - 1;
        while (j >= 0 && (this.rows[j].note || this.rows[j].depth >= r.depth)) j--;
        if (j >= 0) this.setCursor(j, true);
        break;
      }
      case 'Enter': case ' ': this.activate(r); break;
      default: return;
    }
    e.preventDefault();
  }
}

// ---- The reader ----------------------------------------------------------------------
// A file, read only, between the two panels, the way an editor sits beside VS
// Code's explorer (Studio's reader). Markdown shows as a document, its front
// matter as a small table, with its source a click away; other text as
// numbered lines, prose wrapped; pictures as pictures, with their size. A
// link to another file in the project opens that file here. Under the name,
// its size, when it changed, its lines and what git says of it. It follows
// the file as it changes. Esc or × closes it.

const MD = /\.(md|markdown|mdx)$/i;
const WRAP = /\.(md|markdown|mdx|txt)$/i;
const MAX_LINES = 6000;
const when = (ms) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `today at ${time}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })} at ${time}`;
};
// A link's target as a path in the project, from the file it's in; null when
// it's only an anchor or goes outside the project.
const resolveLink = (from, href) => {
  let target = href.split('#')[0].split('?')[0];
  try { target = decodeURI(target); } catch {}
  if (!target) return null;
  const parts = target.startsWith('/') ? [] : from.split('/').slice(0, -1);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/') || null;
};
// The front matter of a Markdown file as [key, value] pairs, as written.
const frontMatter = (text) => {
  const m = String(text).match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return [];
  const out = [];
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s?(.*)$/);
    if (kv) out.push([kv[1], kv[2]]);
    else if (out.length && line.trim()) out[out.length - 1][1] += `${out[out.length - 1][1] ? ' ' : ''}${line.trim()}`;
  }
  return out;
};

class Reader {
  constructor(files) {
    this.files = files;
    this.show_ = store.get(`${files.hooks.key}.reader.md`, 'preview');
    this.el = document.createElement('section');
    this.el.className = 'pg-reader';
    this.el.setAttribute('aria-label', 'File');
    this.el.hidden = true;
    document.getElementById('workspace')?.append(this.el);
    this.el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) this.close();
      if (e.target.closest('[data-finder]')) {
        const r = await fetch('/playground/files/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'files' }, body: JSON.stringify({ path: this.path }) })
          .then((x) => x.json()).catch(() => ({ error: 'The playground isn’t answering' }));
        if (r.error) this.flash('Couldn’t open');
      }
      if (e.target.closest('[data-copy]')) {
        try { await navigator.clipboard.writeText(this.path); this.flash('Copied'); } catch { this.flash('Couldn’t copy'); }
      }
      const seg = e.target.closest('[data-show]');
      if (seg) { this.show_ = seg.dataset.show; store.set(`${this.files.hooks.key}.reader.md`, this.show_); this.load(false, true); }
      // A link to another file in the project opens it here.
      const link = e.target.closest('.link[data-href]');
      if (link) {
        const to = resolveLink(this.path, link.dataset.href);
        if (to) { this.files.selected = to; this.files.draw(); this.show(to); }
        else if (!link.dataset.href.startsWith('#')) this.flash('That link goes outside the project');
      }
    });
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.hidden && !e.defaultPrevented && !document.querySelector('dialog[open]')) this.close();
    });
  }

  flash(text) {
    const b = this.el.querySelector('[data-copy]');
    if (!b) return;
    b.textContent = text;
    setTimeout(() => { if (b.isConnected) b.textContent = 'Copy path'; }, 1400);
  }

  async show(path) {
    this.path = path;
    this.mtime = null;
    await this.load(true);
  }

  // After each poll: read it again if it has changed.
  async follow() {
    if (this.el.hidden || !this.path || this.following) return;
    this.following = true;
    try { await this.load(false); } finally { this.following = false; }
  }

  async load(first, force = false) {
    const path = this.path;
    let f;
    try { f = await getJSON(`/playground/files/read?path=${encodeURIComponent(path)}`); } catch { f = null; }
    if (path !== this.path) return;
    if (!first && !force && f && f.mtime === this.mtime) return;
    this.mtime = f?.mtime;
    const old = this.el.querySelector('.r-body');
    const keep = !first && !force && old ? old.scrollTop : 0;
    const isMd = f?.kind === 'text' && MD.test(path);
    const meta = [];
    let body;
    if (!f) body = '<p class="r-empty">This file isn’t there any more.</p>';
    else if (f.kind === 'image') body = `<div class="r-image"><img src="${esc(f.url)}" alt="${esc(nameOf(path))}"></div>`;
    else if (f.kind === 'binary') body = '<p class="r-empty">This file isn’t text, so it can’t be shown here.</p>';
    else if (f.kind === 'folder') body = '<p class="r-empty">A folder.</p>';
    else if (isMd && this.show_ === 'preview') {
      const fm = frontMatter(f.text);
      const base = new URL(`/${parentOf(path) ? `${parentOf(path).split('/').map(encodeURIComponent).join('/')}/` : ''}`, location.origin).href;
      body = (fm.length ? `<div class="r-fm">${fm.map(([k, v]) => `<span class="k">${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div>` : '')
        + `<div class="r-md">${md(f.text, base)}</div>`;
    } else {
      const all = f.text.split('\n');
      if (all.length > 1 && all[all.length - 1] === '') all.pop();
      const shown = all.slice(0, MAX_LINES);
      meta.push(`${all.length} line${all.length === 1 ? '' : 's'}`);
      body = `<pre class="r-text${WRAP.test(path) ? ' wrap' : ''}">${shown.map((l) => `<span>${esc(l) || ' '}</span>`).join('')}</pre>`
        + (shown.length < all.length ? `<p class="r-note">Showing the first ${shown.length} of ${all.length} lines. Open it in Finder to see the rest.</p>` : '');
    }
    if (f?.truncated) body += '<p class="r-note">Only the first megabyte is shown. Open it in Finder to see the rest.</p>';
    const mk = f ? this.files.markOf(path, false) : null;
    const chips = (mk ? `<span class="r-chip m-${esc(mk.tone)}" title="From git">${esc(mk.why || mk.letter)}</span>` : '')
      + (f && this.files.isIgnored(path) ? '<span class="r-chip" title="From git">Ignored by git</span>' : '');
    const facts = f ? [size(f.size), `changed ${when(f.mtime)}`, ...meta].join(' · ') : '';
    const seg = isMd ? `<span class="r-seg" role="tablist" aria-label="How to show it">${[['preview', 'Preview'], ['source', 'Source']].map(([v, t]) =>
      `<button type="button" role="tab" data-show="${v}" aria-selected="${this.show_ === v}" class="${this.show_ === v ? 'on' : ''}">${t}</button>`).join('')}</span>` : '';
    this.el.innerHTML = `
      <div class="r-head">${iconOf(path)}<span class="r-title"><b title="${esc(path)}">${esc(nameOf(path))}</b>${parentOf(path) ? `<small title="${esc(path)}">${esc(parentOf(path))}</small>` : ''}</span>
        <button type="button" data-copy title="Copy the path, from the project's folder">Copy path</button>
        <button type="button" data-finder title="Show it in Finder">Open in Finder</button>
        <button type="button" class="pg-min" data-close aria-label="Close the file" title="Close (Esc)">×</button></div>
      <div class="r-meta"><span>${esc(facts)}</span>${chips}<span class="grow"></span>${seg}</div>
      <div class="r-body">${body}</div>`;
    const img = this.el.querySelector('.r-image img');
    img?.addEventListener('load', () => {
      const span = this.el.querySelector('.r-meta > span');
      if (span) span.textContent = `${facts} · ${img.naturalWidth} × ${img.naturalHeight} px`;
    });
    this.el.querySelector('.r-body').scrollTop = keep;
    this.el.hidden = false;
    if (first) { this.el.classList.remove('enter'); void this.el.offsetWidth; this.el.classList.add('enter'); }
  }

  close() {
    this.el.hidden = true;
    this.path = null;
    this.files.selected = null;
    this.files.draw();
  }
}
