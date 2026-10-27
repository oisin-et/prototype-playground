// The playground: versions of the app's pages, tried out inside the running
// app (playground/README.md), in two panels either side of the screen, under the
// header and the prototype's bar (they never cover them). Both are open at
// first; each minimises to a strip at its edge and expands again from it, and
// that's kept for next time.
//
// Explorations, on the left, is the file manager. Every screen of the
// prototype is a folder, and each folder holds the explorations of that
// screen (<data>/<screen>/<exploration>/), each with its versions. The
// screen on show is pinned at the top. Clicking a version runs it at once, on
// the same screen and with the same state; "Use this version" makes it the
// prototype's pick, saved to <data>/picks.json. A star marks an exploration
// or a version worth keeping, and "Starred only" hides the rest; the bin
// deletes one, to playground/trash/, with Undo in the toast (serve.py's
// /playground/explorations).
//
// Claude, on the right, is a chat that asks Claude Code for versions (serve.py
// runs it). Each prompt goes to serve.py with what's on show (the screen, its
// parameters and the file it's drawn from, the open folder, the
// exploration and version) and any screenshots, and its steps stream back.
// Screenshots can be dragged in, pasted, or captured from the app: hold ⌥ and
// drag over any part of it (or press the capture button, then drag), and the
// capture is added with the names of the app's widgets it covers (the host's
// capture hook draws it). When a file is saved the app is reloaded, and a
// new version is tried as soon as it exists, so it takes shape on the screen. Follow-ups continue the same Claude conversation.
//
// Chats sit along the top of the panel like a Stepper's steps: Chat 1, and a
// + that opens the next, up to four (serve.py's MAX_RUNS). Each is its own
// Claude conversation with its own run, so several can work at once. Only the chat on show tries its new versions as
// they're made; another chat's new version waits, with an amber badge, and is
// tried when you open it. The chats are kept for this browser tab.
//
// The player does the switching through the hooks passed in; this file only
// draws the buttons and panels, and knows nothing about any particular
// exploration. P minimises or expands both panels. The host passes on what
// the app's frame swallows (⌥, P, N, Esc, pastes) through forward().
//
// Notes, after Agentation: press N (or the pin button by the chat box), then
// click a part of the app, or drag over an area, and write what should
// change. Each note is pinned there with a number, and waits in the chat box,
// as many as you like, until Send takes them all to Claude in one message, with
// a picture of each and the file and line of the widget. Claude answers each
// one (done, a question, or skipped), and the answer shows on its pin. Notes
// are kept in this browser only.

// Part of the prototype-playground kit: the same in every project, and it
// knows nothing about any one. hooks.key prefixes what's kept in the browser;
// hooks.data is where the explorations are, from the project's top.

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_SHOTS = 6;
const ICON_CAPTURE = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 7V4.5A1.5 1.5 0 0 1 4.5 3H7M13 3h2.5A1.5 1.5 0 0 1 17 4.5V7M17 13v2.5a1.5 1.5 0 0 1-1.5 1.5H13M7 17H4.5A1.5 1.5 0 0 1 3 15.5V13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="2.2" fill="currentColor"/></svg>';
const ICON_ATTACH = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><rect x="3" y="4" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4.5 14 3.5-4 2.5 2.5L13 10l2.5 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="13" cy="7.5" r="1.2" fill="currentColor"/></svg>';
const ICON_NOTE = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 17.5s-5.5-5-5.5-9a5.5 5.5 0 0 1 11 0c0 4-5.5 9-5.5 9z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="8.5" r="1.9" fill="currentColor"/></svg>';
const NOTE_INTENTS = [['fix', 'Fix'], ['change', 'Change'], ['question', 'Question']];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get: (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const BRANCH_ICON = '<svg class="pg-branch-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.8"/><circle cx="4.5" cy="12.5" r="1.8"/><circle cx="11.5" cy="5.5" r="1.8"/><path d="M4.5 5.3v5.4M11.5 7.3c0 3-7 2-7 3.4"/></svg>';
const LOCATE_ICON = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="10" cy="10" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="1.8" fill="currentColor"/><path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
const STAR_ICON = '<svg class="pg-star-icon" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="m10 2.6 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 7.9l5-.7z" stroke-linejoin="round"/></svg>';
const BIN_ICON = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.8 10.6a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L15 5.5M8.3 8.5v6M11.7 8.5v6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const MORE_ICON = '<svg class="pg-more-icon" viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><path d="m6 8 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FOLDER_ICON = '<svg class="pg-folder-icon" viewBox="0 0 20 16" aria-hidden="true"><path d="M1 3a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z"/></svg>';

// "Orders · Order {order} · Tab {tab}" → "Orders · Order": a screen's
// title without its parameters, for its folder.
const folderTitle = (title, id) => {
  const out = [];
  for (const seg of String(title || id).split(' · ')) {
    if (!/\{/.test(seg)) out.push(seg);
    else if (out.length < 2) out.push(seg.replace(/\s*\{\w+\}/g, ''));
  }
  return out.join(' · ');
};

export const mountPlayground = (hooks) => {
  const { playgrounds, onPlayground, toast } = hooks;
  // Each panel is a strip (shown while it's minimised) and its body.
  const workspace = document.getElementById('workspace');
  const center = workspace.querySelector('.center');
  const panel = (id, cls, label, side) => {
    const a = document.createElement('aside');
    a.id = id;
    a.className = `pg-panel ${cls}`;
    a.setAttribute('aria-label', label);
    a.innerHTML = `<button type="button" class="pg-rail" aria-expanded="false" aria-controls="${id}-body" title="Expand ${label} (P)">
        <span class="pg-rail-arrow" aria-hidden="true">${side === 'left' ? '›' : '‹'}</span><span class="pg-rail-label">${label}</span><span class="pg-rail-dot" hidden></span>
      </button><div class="pg-body" id="${id}-body"></div>`;
    if (side === 'left') center.before(a); else center.after(a);
    return a;
  };
  const filesPanel = panel('explorations', 'pg-files', 'Explorations', 'left');
  const chatPanel = panel('claude', 'pg-claude', 'Claude', 'right');
  const files = filesPanel.querySelector('.pg-body');
  const chatBody = chatPanel.querySelector('.pg-body');

  let route = null, busy = false, lastSig = '';
  // starred: only starred explorations and versions are shown (the star by the
  // crosshair), kept in this browser.
  const nav = { folder: store.get(`${hooks.key}.playground.folder`, null), starred: store.get(`${hooks.key}.playground.starred`, false) };
  const byId = (id) => playgrounds.find((x) => x.id === id);
  // The default version is main: the app as it is.
  const versionName = (pg, id) => (id === 'default' ? 'main' : pg.versions.find((v) => v.id === id)?.name ?? id);
  const picked = (pg) => hooks.picks()[pg.id] || 'default';
  // A trial of the picked version is no trial: it's what runs anyway.
  const trying = (pg) => (hooks.preview()?.playground === pg.id && hooks.preview().version !== picked(pg) ? hooks.preview().version : null);

  // The folders: the prototype's screens, and any folder an exploration names
  // that isn't one of them.
  const folders = () => {
    const list = hooks.screens().map((s) => ({ id: s.id, title: folderTitle(s.title, s.id) }));
    for (const pg of playgrounds) if (!list.some((f) => f.id === pg.screen)) list.push({ id: pg.screen, title: pg.screen });
    return list.map((f) => ({ ...f, explorations: playgrounds.filter((pg) => pg.screen === f.id) }));
  };
  const folderOf = (id) => folders().find((f) => f.id === id);

  // ---- Stars ---------------------------------------------------------------------
  // A star marks an exploration, or a version, worth keeping ("starred" in its
  // versions.json, through serve.py). Starred explorations come first in their
  // folder and are listed under Starred at the top. With Starred only on, an
  // exploration without a star is hidden unless one of its versions has one, and
  // then only those versions show, with the ones they were copied from (so the
  // graph still joins up), main, the pick and the trial.
  const hasStar = (pg) => !!pg.starred || pg.versions.some((v) => v.starred);
  const shownExplorations = (f) => [...f.explorations].sort((a, b) => !!b.starred - !!a.starred).filter((pg) => !nav.starred || hasStar(pg));
  const shownVersions = (pg) => {
    if (!nav.starred || pg.starred) return pg.versions;
    const keep = new Set(['default']);
    for (const v of pg.versions) if (v.starred || v.id === picked(pg) || v.id === trying(pg)) for (const x of lineage(pg, v.id)) keep.add(x.id);
    return pg.versions.filter((v) => keep.has(v.id));
  };
  const setStarredOnly = (on) => {
    nav.starred = on;
    store.set(`${hooks.key}.playground.starred`, on);
    draw(true);
  };
  const starBtn = (pg, v) => {
    const on = !!(v ? v.starred : pg.starred), what = v ? esc(v.name) : esc(pg.title);
    return `<button type="button" class="pg-icon pg-star${on ? ' on' : ''}" data-star data-pg="${esc(pg.id)}"${v ? ` data-ver="${esc(v.id)}"` : ''}
      aria-pressed="${on}" aria-label="${on ? 'Unstar' : 'Star'} ${what}" title="${on ? 'Unstar' : 'Star'}">${STAR_ICON}</button>`;
  };
  // Each version, and each exploration's title, is a tile: its name, number and
  // date, and its actions. What it says about itself (its note, what it came
  // from) stays folded away until Show more opens it, for as long as the page
  // is open.
  const opened = new Set();
  const moreBtn = (key, what) => {
    const on = opened.has(key);
    return `<button type="button" class="pg-icon pg-more${on ? ' on' : ''}" data-more="${esc(key)}" aria-expanded="${on}"
      aria-label="${on ? 'Show less' : 'Show more'} about ${esc(what)}" title="${on ? 'Show less' : 'Show more'}">${MORE_ICON}</button>`;
  };
  const binBtn = (pg, v) => `<button type="button" class="pg-icon pg-bin" data-delete data-pg="${esc(pg.id)}"${v ? ` data-ver="${esc(v.id)}"` : ''}
      aria-label="Delete ${v ? esc(v.name) : esc(pg.title)}" title="Delete${v ? ' this version' : ' this exploration'} (⇧-click: no question)">${BIN_ICON}</button>`;

  // ---- Minimising and expanding -----------------------------------------------
  const isOpen = (el) => !el.classList.contains('min');
  // At phone width a panel floats over the app, so only one is open at a time.
  const narrow = () => matchMedia('(max-width: 760px)').matches;
  const setOpen = (which, open) => {
    const el = which === 'files' ? filesPanel : chatPanel;
    if (open && narrow()) {
      const other = which === 'files' ? chatPanel : filesPanel;
      other.classList.add('min');
      other.querySelector('.pg-rail').setAttribute('aria-expanded', 'false');
    }
    el.classList.toggle('min', !open);
    el.querySelector('.pg-rail').setAttribute('aria-expanded', String(open));
    store.set(`${hooks.key}.playground.panels`, { files: isOpen(filesPanel), chat: isOpen(chatPanel) });
    if (which === 'files') draw(true);
  };
  filesPanel.querySelector('.pg-rail').addEventListener('click', () => setOpen('files', true));
  chatPanel.querySelector('.pg-rail').addEventListener('click', () => { setOpen('chat', true); chatBody.querySelector('textarea')?.focus(); });
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'p' || e.key === 'P') {
      const open = !isOpen(filesPanel) || !isOpen(chatPanel);
      setOpen('files', open);
      setOpen('chat', open);
    }
  });

  // Runs a hook, one at a time, with the panel showing it's busy.
  const run = async (fn) => {
    if (busy) return;
    busy = true;
    filesPanel.classList.add('busy');
    // Redraw only if something changed: a rebuild would cut short the glider's spring.
    try { return await fn(); } finally { busy = false; filesPanel.classList.remove('busy'); draw(); }
  };
  const openFolder = (id) => {
    nav.folder = id;
    store.set(`${hooks.key}.playground.folder`, id);
    draw(true);
    files.querySelector('.pg-list')?.scrollTo(0, 0);
  };
  // The crosshair: the page on show's folder, scrolled to the version being
  // tried there, or else the picked one.
  const locate = () => {
    if (!route) return;
    openFolder(route.screen);
    const rows = [...files.querySelectorAll('.pg-version.running')];
    const row = rows.find((r) => r.querySelector('.pg-chip.try')) || rows.find((r) => !r.classList.contains('main'));
    row?.scrollIntoView({ block: 'center', behavior: still() ? 'auto' : 'smooth' });
  };

  // ---- Explorations panel ----------------------------------------------------
  // A minimised panel's strip keeps a mark: amber while a version is being
  // tried, blue while Claude is working.
  const drawRails = () => {
    const p = hooks.preview(), pg = p && byId(p.playground);
    const fileDot = filesPanel.querySelector('.pg-rail-dot'), chatDot = chatPanel.querySelector('.pg-rail-dot');
    fileDot.hidden = !pg;
    fileDot.title = pg ? `Trying ${versionName(pg, p.version)}` : '';
    const working = tabs.filter((t) => t.running).length;
    chatDot.hidden = !working;
    chatDot.title = working ? (working === 1 ? 'Claude is working' : `${working} chats are working`) : '';
  };

  // ---- The graph ---------------------------------------------------------------
  // Drawn like a git graph (GitHub, VS Code), so it reads the way a commit will
  // work: main is the prototype as it is (the default version), an exploration
  // is a branch off main, and each version is a commit on it, joined to the
  // version it was copied from ("from" in versions.json). Newest at the top.
  // The picked version's line back to main is blue: it's what a commit to main
  // would bring in, and a dashed node at the top of main's lane says so, with
  // the pages it would change. A version being tried is amber.
  const LANE = 14, MAIN_X = 15, NODE_Y = 19, R = 8;
  const versionById = (pg, id) => pg.versions.find((v) => v.id === id);
  const parentOf = (pg, v) => (v.from && v.from !== v.id && versionById(pg, v.from) ? v.from : 'default');
  // The versions a commit of this one brings in: it and those it was copied
  // from, back to main, oldest first.
  const lineage = (pg, id) => {
    const out = [];
    for (let v = versionById(pg, id); v && v.id !== 'default' && !out.includes(v); v = versionById(pg, parentOf(pg, v))) out.unshift(v);
    return out;
  };
  // A lane per branch: main is lane 0, the first copy of a version carries on
  // in its lane, and any other copy starts a lane of its own.
  const lanesOf = (pg) => {
    const lane = { default: 0 }, carried = new Set();
    let count = 1;
    for (const v of pg.versions) {
      if (v.id === 'default') continue;
      const p = parentOf(pg, v);
      if (p !== 'default' && lane[p] != null && !carried.has(p)) { lane[v.id] = lane[p]; carried.add(p); } else lane[v.id] = count++;
    }
    return { lane, count };
  };
  // Lanes close up when there are many, so the graph never takes more than
  // about a fifth of the panel from the names.
  const laneGap = (pg) => Math.min(LANE, 36 / Math.max(1, lanesOf(pg).count - 1));
  const gutter = (pg) => Math.round(MAIN_X + (lanesOf(pg).count - 1) * laneGap(pg) + 13);
  // What a version does to main, in screen names: the screens it replaces and
  // the ones it adds.
  const changesOf = (pg, v) => {
    const own = new Map(hooks.screens().map((s) => [s.id, folderTitle(s.title, s.id)]));
    const name = (id) => own.get(id) || id;
    const pages = hooks.touches?.(pg, v.id) || [pg.screen];
    const changed = pages.filter((id) => own.has(id)).map(name), added = pages.filter((id) => !own.has(id)).map(name);
    const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
    return [changed.length && `changes ${list(changed)}`, added.length && `adds ${list(added)}`].filter(Boolean).join(', ');
  };
  const trail = (pg, id) => lineage(pg, id).map((v) => esc(v.name)).join(' › ');
  // The row at the top of main's lane: what a commit to main would bring in.
  const mergeRow = (pg) => {
    const pick = picked(pg), t = trying(pg);
    if (pick === 'default' && !t) return '';
    const target = t || pick, v = versionById(pg, target);
    const what = v ? changesOf(pg, v) : '';
    const head = t
      ? `<b>Trying ${esc(versionName(pg, t))}</b><small>${t === 'default' ? `Use this version to take ${esc(pg.title)} out of the prototype, so main's pages run again.`
        : `Use this version, and a commit to main brings in ${trail(pg, t)}${pick !== 'default' ? `, in place of ${esc(versionName(pg, pick))}` : ''}.`}</small>`
      : `<b>Ready for main</b><small>A commit to main brings in ${trail(pg, pick)}.</small>`;
    return `<li class="pg-merge${t ? ' trying' : ''}" title="Committing to main moves these pages into the app for good: Commit, at the top right.">
      ${head}${what && t !== 'default' ? `<small class="pg-changes">It ${esc(what)}.</small>` : ''}</li>`;
  };
  const versionRow = (pg, v) => {
    const isPicked = picked(pg) === v.id, isTrying = trying(pg) === v.id;
    const running = isTrying || (isPicked && !trying(pg));
    const main = v.id === 'default', key = `${pg.id}/${v.id}`, open = opened.has(key);
    const from = main ? '' : `from ${parentOf(pg, v) === 'default' ? 'main' : versionName(pg, parentOf(pg, v))}`;
    const about = [from, v.note].filter(Boolean);
    return `<li class="pg-version${running ? ' running' : ''}${main ? ' main' : ''}${open ? ' open' : ''}" data-v="${esc(v.id)}">
      <div class="pg-tile">
        <button type="button" class="pg-try" data-pg="${esc(pg.id)}" data-v="${esc(v.id)}" aria-pressed="${running}" title="${esc(main ? 'main' : v.name)}">
          <b class="pg-vname">${main ? 'main' : esc(v.name)}</b>
          <span class="pg-vmeta">${main ? 'the app as it is' : `<span class="pg-vwhen">${esc(v.id)} · ${esc(v.date)}</span>`}${isPicked ? '<span class="pg-chip pick">In the prototype</span>' : ''}${isTrying ? '<span class="pg-chip try">Trying</span>' : ''}</span>
        </button>
        <span class="pg-tools${v.starred ? ' starred' : ''}">${about.length ? moreBtn(key, main ? 'main' : v.name) : ''}${main ? '' : starBtn(pg, v) + binBtn(pg, v)}</span>
      </div>
      ${open && about.length ? `<p class="pg-note">${from ? `<span class="pg-from">${esc(from)}</span>` : ''}${from && v.note ? ' · ' : ''}${esc(v.note)}</p>` : ''}
    </li>`;
  };
  const exploration = (pg) => {
    const shown = shownVersions(pg), hidden = pg.versions.length - shown.length, open = opened.has(pg.id);
    return `<section class="pg-group${pg.starred ? ' starred' : ''}">
      <h3>${BRANCH_ICON}<span class="pg-gtitle" title="${esc(pg.title)}">${esc(pg.title)}</span><span class="pg-tools${pg.starred ? ' starred' : ''}">${pg.about ? moreBtn(pg.id, pg.title) : ''}${starBtn(pg)}${binBtn(pg)}</span></h3>
      ${open && pg.about ? `<p class="pg-about">${esc(pg.about)}</p>` : ''}
      <ol class="pg-versions" data-pg="${esc(pg.id)}" style="--gutter:${gutter(pg)}px">
        <li class="pg-glider" aria-hidden="true"></li><li class="pg-graph-holder" aria-hidden="true"><svg class="pg-graph"></svg></li>
        ${mergeRow(pg)}${[...shown].reverse().map((v) => versionRow(pg, v)).join('')}</ol>
      ${hidden ? `<p class="pg-hidden">${hidden} version${hidden === 1 ? '' : 's'} without a star ${hidden === 1 ? 'is' : 'are'} hidden. <button type="button" class="pg-link" data-all>Show all</button></p>` : ''}
    </section>`;
  };
  // Lines and nodes are drawn after layout, from where the rows landed.
  const drawGraph = (list) => {
    const pg = byId(list.dataset.pg), svg = list.querySelector('.pg-graph');
    if (!pg || !svg) return;
    const { lane } = lanesOf(pg);
    const gap = laneGap(pg), x = (id) => MAIN_X + (lane[id] ?? 0) * gap;
    const rows = Object.fromEntries([...list.querySelectorAll('.pg-version')].map((r) => [r.dataset.v, r.offsetTop + NODE_Y]));
    const mergeEl = list.querySelector('.pg-merge');
    const pick = picked(pg), t = trying(pg);
    const blue = new Set(lineage(pg, pick).map((v) => v.id)), amber = new Set(lineage(pg, t).map((v) => v.id));
    // Down a lane from (x1, y1) to row y2, then across to x2, round the corner.
    const link = (x1, y1, x2, y2) => {
      if (x1 === x2) return `M${x1} ${y1}V${y2}`;
      const dy = Math.sign(y2 - y1), dx = Math.sign(x2 - x1), r = Math.min(R, Math.abs(y2 - y1), Math.abs(x2 - x1));
      return `M${x1} ${y1}V${y2 - dy * r}Q${x1} ${y2} ${x1 + dx * r} ${y2}H${x2}`;
    };
    const paths = [], nodes = [];
    const my = mergeEl ? mergeEl.offsetTop + NODE_Y : null;
    if (my != null && rows.default != null) paths.push(['main', link(MAIN_X, rows.default, MAIN_X, my)]);
    for (const v of pg.versions) {
      if (v.id === 'default' || rows[v.id] == null) continue;
      const p = parentOf(pg, v);
      const cls = blue.has(v.id) ? 'pick' : amber.has(v.id) ? 'try' : '';
      paths.push([cls, link(x(v.id), rows[v.id], x(p), rows[p])]);
      nodes.push(`<circle class="${v.id === pick ? 'pick head' : v.id === t ? 'try head' : cls}" cx="${x(v.id)}" cy="${rows[v.id]}" r="${v.id === pick || v.id === t ? 5 : 4}"/>`);
    }
    if (my != null) {
      // While trying, only the trial's line goes to main: it's what Use would change.
      if (pick !== 'default' && !t && rows[pick] != null) paths.push(['pick merge', link(x(pick), rows[pick], MAIN_X, my)]);
      if (t && t !== 'default' && rows[t] != null) paths.push(['try merge', link(x(t), rows[t], MAIN_X, my)]);
      nodes.push(`<circle class="incoming${t ? ' try' : ''}" cx="${MAIN_X}" cy="${my}" r="6"/>`);
    }
    if (rows.default != null) nodes.push(`<circle class="main${pick === 'default' && !t ? ' pick' : ''}" cx="${MAIN_X}" cy="${rows.default}" r="5"/>`);
    // Grey first, then amber, then blue on top, so a shared stretch shows the pick.
    const order = (c) => (c.startsWith('pick') ? 3 : c.startsWith('try') ? 2 : c === 'main' ? 1 : 0);
    paths.sort((a, b) => order(a[0]) - order(b[0]));
    svg.setAttribute('width', list.offsetWidth);
    svg.setAttribute('height', list.offsetHeight);
    svg.innerHTML = paths.map(([c, d]) => `<path class="${c}" d="${d}"/>`).join('') + nodes.join('');
  };
  const graphSizes = new ResizeObserver((entries) => { for (const e of entries) drawGraph(e.target); });
  const drawGraphs = () => {
    graphSizes.disconnect();
    for (const list of files.querySelectorAll('.pg-versions')) { drawGraph(list); graphSizes.observe(list); }
  };
  document.fonts?.ready.then(() => drawGraphs());

  // Everything picked, across the explorations: what a commit to main would
  // bring in all together.
  const readyRows = () => {
    const ready = playgrounds.filter((pg) => picked(pg) !== 'default');
    return ready.length ? `<li class="pg-ready-head"><svg class="pg-ready-graph" viewBox="0 0 30 40" aria-hidden="true"><path class="main" d="M13 20V40"/><circle class="incoming" cx="13" cy="20" r="6"/></svg>
      <span><b>Into main</b><small>Commit, at the top right, brings in ${ready.length === 1 ? 'this pick' : `these ${ready.length} picks`}.</small></span></li>${ready.map(readyRow).join('')}` : '';
  };
  const readyRow = (pg) => {
    const v = versionById(pg, picked(pg)), what = v ? changesOf(pg, v) : '';
    return `<li><button type="button" class="pg-ready" data-folder="${esc(pg.screen)}">
      <svg class="pg-ready-graph" viewBox="0 0 30 46" aria-hidden="true"><path class="main" d="M13 0V46"/><path class="pick" d="M23 30V16Q23 8 15 8H13"/><circle class="pick head" cx="23" cy="30" r="4"/></svg>
      <span class="pg-fname"><b>${esc(pg.title)} › ${esc(versionName(pg, picked(pg)))}</b><small title="${esc(what)}">${esc(what || folderTitle(folderOf(pg.screen)?.title, pg.screen))}</small></span>
      <span class="pg-chevron" aria-hidden="true">›</span></button></li>`;
  };
  // Starred, at the top: each starred exploration opens its folder, and each
  // starred version is tried at once.
  const starredRows = () => playgrounds.flatMap((pg) => [
    ...(pg.starred ? [`<li><button type="button" class="pg-folder" data-folder="${esc(pg.screen)}">${STAR_ICON}
      <span class="pg-fname"><b>${esc(pg.title)}</b><small>${esc(folderTitle(folderOf(pg.screen)?.title, pg.screen))} · ${pg.versions.filter((v) => v.id !== 'default').length} versions</small></span>
      <span class="pg-chevron" aria-hidden="true">›</span></button></li>`] : []),
    ...pg.versions.filter((v) => v.starred).map((v) => `<li><button type="button" class="pg-folder" data-pg="${esc(pg.id)}" data-v="${esc(v.id)}">${STAR_ICON}
      <span class="pg-fname"><b>${esc(pg.title)} › ${esc(v.name)}</b><small>${esc(v.id)} · ${esc(v.date)} · try it</small></span>
      ${trying(pg) === v.id ? '<span class="pg-chip try">Trying</span>' : picked(pg) === v.id ? '<span class="pg-chip pick">Picked</span>' : ''}</button></li>`),
  ]).join('');
  const folderRow = (f) => {
    const versions = f.explorations.reduce((n, pg) => n + pg.versions.filter((v) => v.id !== 'default').length, 0);
    const stars = f.explorations.filter(hasStar).length;
    const meta = f.explorations.length
      ? `${f.explorations.length} exploration${f.explorations.length === 1 ? '' : 's'} · ${versions} version${versions === 1 ? '' : 's'}${stars ? ` · ${stars} starred` : ''}`
      : 'Empty';
    const tryingHere = f.explorations.some((pg) => trying(pg));
    return `<li><button type="button" class="pg-folder${f.explorations.length ? '' : ' empty'}" data-folder="${esc(f.id)}">
      ${FOLDER_ICON}<span class="pg-fname"><b>${esc(f.title)}</b><small>${meta}</small></span>
      ${tryingHere ? '<span class="pg-chip try">Trying</span>' : ''}<span class="pg-chevron" aria-hidden="true">›</span>
    </button></li>`;
  };

  // ---- Motion -----------------------------------------------------------------
  // After React Bits' Stepper: the running version rides on a tile that springs
  // from row to row; moving between folders slides the new list in from the
  // side you're heading; the trial card springs in when a trial starts. With
  // reduced motion, things just appear.
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRING = getComputedStyle(document.documentElement).getPropertyValue('--spring').trim() || 'ease-out';
  const gliderAt = {}; // exploration id → { y, h } where its glider last sat
  const placeGliders = () => {
    for (const list of files.querySelectorAll('.pg-versions')) {
      const glider = list.querySelector('.pg-glider');
      const row = list.querySelector('.pg-version.running');
      const key = list.dataset.pg;
      if (!row) { glider.style.opacity = '0'; delete gliderAt[key]; continue; }
      const to = { y: row.offsetTop, h: row.offsetHeight };
      const from = gliderAt[key];
      const put = ({ y, h }) => { glider.style.transform = `translate3d(0, ${y}px, 0)`; glider.style.height = `${h}px`; };
      glider.classList.toggle('trying', !!row.querySelector('.pg-chip.try'));
      glider.style.transition = 'opacity 200ms ease';
      if (from && !still() && (from.y !== to.y || from.h !== to.h)) {
        put(from);
        glider.style.opacity = '1';
        glider.getBoundingClientRect(); // start from where it was
        glider.style.transition = `transform 560ms ${SPRING}, height 560ms ${SPRING}, opacity 200ms ease`;
      }
      put(to);
      glider.style.opacity = '1';
      gliderAt[key] = to;
    }
  };
  let lastLevel = null, hadTrial = false;
  const hiddenNote = (f) => {
    const n = f.explorations.length - shownExplorations(f).length;
    return n ? `<p class="pg-hidden">${n} exploration${n === 1 ? '' : 's'} without a star ${n === 1 ? 'is' : 'are'} hidden. <button type="button" class="pg-link" data-all>Show all</button></p>` : '';
  };

  const draw = (force = false) => {
    drawRails();
    drawContext();
    if (!isOpen(filesPanel)) return;
    const p = hooks.preview();
    const sig = JSON.stringify([route?.screen, nav.folder, hooks.picks(), p, hooks.local(), nav.starred, playgrounds.map((x) => [x.id, x.versions.length, !!x.starred, x.versions.filter((v) => v.starred).map((v) => v.id).join()])]);
    if (!force && sig === lastSig) return;
    lastSig = sig;
    const pg = p && byId(p.playground) && trying(byId(p.playground)) ? byId(p.playground) : null;
    const all = folders();
    const folder = nav.folder && all.find((f) => f.id === nav.folder);
    if (nav.folder && !folder) nav.folder = null;

    let body;
    if (!folder) {
      const current = route && all.find((f) => f.id === route.screen);
      // The screen on show is pinned at the top, so it isn't listed again below.
      const rest = all.filter((f) => f !== current);
      // With Starred only on, folders with nothing starred are left out.
      const used = rest.filter((f) => shownExplorations(f).length), empty = nav.starred ? [] : rest.filter((f) => !f.explorations.length);
      const unstarred = nav.starred ? rest.filter((f) => f.explorations.length && !shownExplorations(f).length).length : 0;
      const ready = readyRows(), starred = starredRows();
      body = `
        ${ready ? `<h4>Ready for main</h4><ul class="pg-folders pg-readies">${ready}</ul>` : ''}
        ${starred ? `<h4>Starred</h4><ul class="pg-folders pg-starred">${starred}</ul>` : ''}
        ${current ? `<h4>On screen now</h4><ul class="pg-folders">${folderRow(current)}</ul>` : ''}
        ${used.length ? `<h4>Explorations</h4><ul class="pg-folders">${used.map(folderRow).join('')}</ul>` : ''}
        ${empty.length ? `<h4>No explorations yet</h4><ul class="pg-folders">${empty.map(folderRow).join('')}</ul>` : ''}
        ${nav.starred ? `<p class="pg-hidden">${starred ? 'Only what has a star shows' : 'Nothing has a star yet: star an exploration or a version to keep it here'}${unstarred
          ? `, so ${unstarred} screen${unstarred === 1 ? '' : 's'} with explorations ${unstarred === 1 ? 'is' : 'are'} hidden` : ''}. <button type="button" class="pg-link" data-all>Show all</button></p>` : ''}`;
    } else {
      const onIt = route?.screen === folder.id;
      body = `
        <div class="pg-crumbs"><button type="button" class="pg-up" data-up>‹ All screens</button><span>${esc(folder.title)}</span></div>
        <p class="pg-path"><code>${esc(hooks.data)}/${esc(folder.id)}/</code>
          ${onIt ? '<span class="pg-chip here">On screen</span>' : `<button type="button" data-show="${esc(folder.id)}">Show this screen</button>`}</p>
        ${folder.explorations.length ? shownExplorations(folder).map(exploration).join('') + hiddenNote(folder)
          : `<p class="pg-empty">No explorations of ${esc(folder.title)} yet. ${chat.enabled
            ? 'Ask Claude on the right to start one.'
            : `Set up Claude on the right to start one, or run <code>python3 playground/new.py ${esc(folder.id)} &lt;name&gt; "Title"</code>.`}</p>`}`;
    }

    const level = nav.folder || '';
    const moved = lastLevel !== null && level !== lastLevel && !still() ? (level ? 'forward' : 'back') : '';
    lastLevel = level;
    const trialEnters = !!pg && !hadTrial && !still();
    hadTrial = !!pg;
    files.innerHTML = `
      <div class="pg-head"><h2>Explorations</h2><button type="button" class="pg-locate pg-filter${nav.starred ? ' on' : ''}" data-starred-only aria-pressed="${nav.starred}" aria-label="Starred only" title="${nav.starred ? 'Show everything' : 'Show only what has a star'}">${STAR_ICON}</button><button type="button" class="pg-locate" data-locate aria-label="Show the page on show" title="Go to the page on show">${LOCATE_ICON}</button><button type="button" class="pg-min" data-close aria-label="Minimise Explorations" title="Minimise (P)">‹</button></div>
      ${hooks.local() ? `<div class="pg-local"><p>Your picks are saved in this browser only, because the server can't write
        <code>${esc(hooks.data)}/picks.json</code>. Run <code>python3 playground/serve.py</code> to save them there.</p>
        <button type="button" data-team>Use the saved picks</button></div>` : ''}
      <div class="pg-list"><div class="pg-pane${moved ? ` enter-${moved}` : ''}">${body}</div></div>
      ${pg ? `<div class="pg-actions${trialEnters ? ' enter' : ''}" role="group" aria-label="Trying ${esc(versionName(pg, p.version))}">
          <button type="button" data-back title="Back to ${esc(versionName(pg, picked(pg)))}: drop the trial">Back to ${esc(versionName(pg, picked(pg)))}</button>
          <button type="button" class="pg-use" data-use>Use this version</button>
        </div>`
      : `<div class="pg-foot"><p>As on GitHub: <b>main</b> is the app as it is, each exploration is a branch off it, and each version a commit on that branch.
        Click a version to try it, then <b>Use this version</b> to get it ready for main.</p></div>`}`;
    placeGliders();
    drawGraphs();
    drawCommitBtn();
  };

  files.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('close' in t.dataset) return setOpen('files', false);
    if ('starredOnly' in t.dataset) return setStarredOnly(!nav.starred);
    if ('all' in t.dataset) return setStarredOnly(false);
    if (t.dataset.more) { if (!opened.delete(t.dataset.more)) opened.add(t.dataset.more); return draw(true); }
    if ('star' in t.dataset) return starIt(byId(t.dataset.pg), t.dataset.ver);
    if ('delete' in t.dataset) return deleteIt(byId(t.dataset.pg), t.dataset.ver, e.shiftKey);
    if ('locate' in t.dataset) return locate();
    if (t.dataset.folder) return openFolder(t.dataset.folder);
    if ('up' in t.dataset) return openFolder(null);
    if (t.dataset.show) return hooks.show(t.dataset.show);
    if (t.dataset.v) return run(() => hooks.tryVersion(byId(t.dataset.pg), t.dataset.v));
    if ('back' in t.dataset) return run(() => hooks.endPreview());
    if ('team' in t.dataset) return run(async () => { await hooks.useTeamPicks(); toast(`Running the picks saved in ${hooks.data}/picks.json.`); });
    if ('use' in t.dataset) {
      const p = hooks.preview(), pg = byId(p.playground);
      return run(async () => {
        const where = await hooks.use(pg, p.version);
        toast(where === 'team'
          ? `${versionName(pg, p.version)} is in the prototype now, ready for main (${hooks.data}/picks.json).`
          : `${versionName(pg, p.version)} is in the prototype in this browser. Run playground/serve.py to save it.`);
      });
    }
  });

  // ---- Star and delete ---------------------------------------------------------
  // The star and the bin beside each exploration and version (they show on
  // hover, and a star stays). A delete asks first (⇧-click doesn't), moves the
  // folder to playground/trash/, and the toast's Undo puts it back.
  const starIt = (pg, vid) => {
    if (!pg) return;
    const v = vid && versionById(pg, vid), on = !(v ? v.starred : pg.starred);
    return run(async () => {
      try { await hooks.star(pg, vid || null, on); } catch (err) { toast(`Couldn't ${on ? 'star' : 'unstar'} it: ${err.message}`); }
    });
  };
  const askDialog = document.createElement('dialog');
  askDialog.className = 'pg-modal pg-ask-modal';
  askDialog.setAttribute('aria-labelledby', 'pg-ask-title');
  document.body.append(askDialog);
  const ask = (title, lines, ok) => new Promise((done) => {
    askDialog.innerHTML = `<div class="pg-modal-card">
      <div class="pg-head"><h2 id="pg-ask-title">${esc(title)}</h2><button type="button" class="pg-min" data-no aria-label="Close">×</button></div>
      <div class="pg-modal-body">${lines.map((l) => `<p>${l}</p>`).join('')}</div>
      <div class="pg-modal-foot"><button type="button" data-no>Cancel</button><button type="button" class="pg-danger" data-yes>${esc(ok)}</button></div>
    </div>`;
    const end = (yes) => { askDialog.onclose = null; if (askDialog.open) askDialog.close(); done(yes); };
    askDialog.onclick = (e) => {
      if (e.target === askDialog) return end(false); // the backdrop
      const b = e.target.closest('button');
      if (b) end('yes' in b.dataset);
    };
    askDialog.onclose = () => end(false);
    askDialog.showModal();
    askDialog.querySelector('[data-yes]').focus();
  });
  const deleteIt = async (pg, vid, quick) => {
    if (!pg || busy) return;
    const v = vid && versionById(pg, vid);
    if (vid && !v) return;
    const count = pg.versions.filter((x) => x.id !== 'default').length;
    const pick = picked(pg), what = v ? `${pg.title} › ${v.name}` : pg.title;
    const lines = v
      ? [`<b>${esc(v.name)}</b> (${esc(v.id)}) and its files go to <code>playground/trash/</code>.`,
        ...(pick === v.id ? [`It's in the prototype, so ${esc(pg.title)} goes back to main.`] : []),
        ...(pg.versions.some((x) => x.from === v.id) ? ['The versions copied from it stay, joined to the one it came from.'] : [])]
      : [`<b>${esc(pg.title)}</b> and its ${count} version${count === 1 ? '' : 's'} go to <code>playground/trash/</code>.`,
        ...(pick !== 'default' ? [`Its pick, ${esc(versionName(pg, pick))}, is in the prototype, so its pages go back to main.`] : [])];
    lines.push('You can undo it straight after, and the trash keeps it for 14 days.');
    if (!quick && !(await ask(`Delete ${what}?`, lines, 'Delete'))) return;
    let trash = null;
    await run(async () => {
      try { trash = await hooks.remove(pg, vid || null); } catch (err) { toast(`Couldn't delete ${what}: ${err.message}`); }
    });
    if (trash) toast(`Deleted ${what}.`, { label: 'Undo', run: () => run(async () => {
      try { await hooks.restore(trash); toast(`${what} is back.`); } catch (err) { toast(`Couldn't put it back: ${err.message}`); }
    }) });
  };

  // ---- Commit to main ----------------------------------------------------------
  // The Commit button, at the top right of the header, opens a dialog that says
  // what a commit would do (GET /playground/commit): the picks, the branch, and
  // the other changes nobody committed. Committing has Claude Code move each
  // picked version into the app's own files, puts its pick back to main, and
  // commits the files the move changed on this computer (serve.py's Commit,
  // which streams the steps). Nothing is pushed. Explorations stay on this
  // computer. When it's done the page reloads, with main as it is now.
  // (A function, and it looks the button up itself, because draw() calls it
  // before this part has run.)
  function drawCommitBtn() {
    const btn = document.getElementById('btn-commit');
    if (!btn) return;
    const n = playgrounds.filter((pg) => picked(pg) !== 'default').length;
    const count = btn.querySelector('.pg-count');
    count.hidden = !n;
    count.textContent = n;
    btn.classList.toggle('ready', n > 0);
  }
  const commitBtn = document.getElementById('btn-commit');

  const dialog = document.createElement('dialog');
  dialog.className = 'pg-modal';
  dialog.setAttribute('aria-labelledby', 'pg-modal-title');
  document.body.append(dialog);
  const commit = { info: null, state: 'idle', steps: [], result: null, error: '', other: false, note: '', showOther: false };
  const ST = { A: ['add', 'New file'], M: ['mod', 'Changed'], D: ['del', 'Deleted'] };
  const fileRow = (path, status) => `<li>${status ? `<span class="pg-st ${ST[status][0]}" title="${ST[status][1]}">${status}</span>` : ''}<code title="${esc(path)}">${esc(path)}</code></li>`;
  const commitCard = (p, n) => `<li class="pg-ccard">
      <div class="pg-ctitle"><span class="pg-cnum">${n}</span><b>${esc(p.title)} › ${esc(p.name)}</b></div>
      <p class="pg-ctrail">${esc(p.playground)} · ${esc(p.version)}</p>
      ${p.note ? `<p class="pg-cnote">${esc(p.note)}</p>` : ''}
    </li>`;
  const drawCommit = () => {
    const i = commit.info, picks = i?.picks || [];
    const other = Object.entries(i?.other || {}).sort(([a], [b]) => a.localeCompare(b));
    const ready = picks.length || (commit.other && other.length);
    const p = hooks.preview(), tried = p && byId(p.playground) && trying(byId(p.playground)) ? byId(p.playground) : null;
    let body, foot;
    if (commit.state === 'loading') {
      body = '<p class="pg-cwait">Working out what a commit would do…</p>';
      foot = '<button type="button" data-cancel>Cancel</button>';
    } else if (commit.state === 'unavailable') {
      body = '<p>Commits need the playground\'s own server. Run <code>python3 playground/serve.py --open</code> at the top of the project, then open the playground again.</p>';
      foot = '<button type="button" data-cancel>Close</button>';
    } else if (commit.state === 'running' || commit.state === 'done' || commit.state === 'failed') {
      const r = commit.result;
      body = `<ol class="pg-csteps">${commit.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${r?.commits?.length ? `<h4>Committed to ${esc(r.branch)}</h4><ul class="pg-cdone">${r.commits.map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.message)}</li>`).join('')}</ul>
          <p class="pg-cok">Committed on this computer. Nothing was pushed: <code>git push</code> shares it.</p>` : ''}
        ${commit.error ? `<p class="pg-cproblem">${esc(commit.error)}</p>` : ''}
        ${commit.state === 'running' ? '<p class="pg-cwait">Working… This can take a few minutes while Claude moves the picks.</p>' : ''}`;
      foot = commit.state === 'running' ? ''
        : `<button type="button" class="pg-use" data-finish>${r?.commits?.length ? 'Reload the playground' : 'Close'}</button>`;
    } else {
      const problems = i.problems || [];
      body = `
        ${i.git ? `<p class="pg-cbranch">Commits to <b>${esc(i.branch || '?')}</b> on this computer. Nothing is pushed.</p>` : ''}
        <p class="pg-cabout">A commit makes your picks part of the app. Claude moves each picked version into the app's own files, its pick goes back to main in Explorations, and the files the move changed are committed together.</p>
        ${tried ? `<p class="pg-cnotice">You're trying ${esc(versionName(tried, p.version))}. It isn't picked, so it's not in this commit: press <b>Use this version</b> first to include it.</p>` : ''}
        ${hooks.local() ? `<p class="pg-cnotice">Your picks are saved in this browser only. A commit uses the picks in <code>${esc(hooks.data)}/picks.json</code>.</p>` : ''}
        ${picks.length ? `<h4>Picks</h4><ol class="pg-ccards">${picks.map((x, n) => commitCard(x, n + 1)).join('')}</ol>`
          : '<p class="pg-cempty">No version is picked yet. Try a version in Explorations and press <b>Use this version</b> to get it ready for main.</p>'}
        ${other.length ? `<div class="pg-cother">
          <label class="pg-check"><input type="checkbox" data-other ${commit.other ? 'checked' : ''}> Also commit the ${other.length} other change${other.length === 1 ? '' : 's'} nobody committed</label>
          <button type="button" class="pg-link" data-show-other aria-expanded="${commit.showOther}">${commit.showOther ? 'Hide' : 'Show'} them</button>
          ${commit.showOther ? `<ul class="pg-cfiles">${other.map(([f, st]) => fileRow(f, st)).join('')}</ul>` : ''}
        </div>` : ''}
        <p class="pg-cprivate">Explorations stay on this computer: the versions, their notes and your picks are never committed.</p>
        <label class="pg-cnote-label">A note for the commit <small>(optional)</small>
          <textarea data-note rows="2" placeholder="What this is and why">${esc(commit.note)}</textarea></label>
        ${problems.length ? `<p class="pg-cproblem">Can't commit yet: ${esc(problems[0])}</p>` : ''}`;
      foot = `<button type="button" data-cancel>Cancel</button>
        <button type="button" class="pg-use" data-commit ${!ready || problems.length ? 'disabled' : ''}>${ready ? 'Commit' : 'Nothing to commit'}</button>`;
    }
    dialog.innerHTML = `<div class="pg-modal-card">
      <div class="pg-head"><h2 id="pg-modal-title">Commit to main</h2>${commit.state === 'running' ? '' : '<button type="button" class="pg-min" data-cancel aria-label="Close">×</button>'}</div>
      <div class="pg-modal-body">${body}</div>
      ${foot ? `<div class="pg-modal-foot">${foot}</div>` : ''}
    </div>`;
  };
  const loadCommit = async () => {
    commit.state = 'loading';
    drawCommit();
    try {
      const r = await fetch('/playground/commit', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      commit.info = await r.json();
      commit.state = 'plan';
    } catch {
      commit.state = 'unavailable';
    }
    if (dialog.open) drawCommit();
  };
  const runCommit = async () => {
    Object.assign(commit, { state: 'running', steps: [], result: null, error: '' });
    drawCommit();
    try {
      const r = await fetch('/playground/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'commit' },
        body: JSON.stringify({ other: commit.other, note: commit.note }),
      });
      if (!r.ok) throw new Error(`The server said ${r.status}.`);
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          let e;
          try { e = JSON.parse(line); } catch { continue; }
          if (e.type === 'step') commit.steps.push(e.text);
          if (e.type === 'done') commit.result = e;
          if (e.type === 'error') commit.error = e.message;
          drawCommit();
        }
      }
      commit.state = commit.error || !commit.result ? 'failed' : 'done';
      if (!commit.error && !commit.result) commit.error = 'The commit stopped before it finished.';
    } catch (err) {
      commit.error = err.message === 'Failed to fetch' ? 'Lost the connection to serve.py.' : err.message;
      commit.state = 'failed';
    }
    drawCommit();
  };
  commitBtn?.addEventListener('click', () => {
    Object.assign(commit, { steps: [], result: null, error: '', showOther: false });
    if (!dialog.open) dialog.showModal();
    loadCommit();
  });
  dialog.addEventListener('cancel', (e) => { if (commit.state === 'running') e.preventDefault(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && commit.state !== 'running') return dialog.close(); // the backdrop
    const t = e.target.closest('button');
    if (!t) return;
    if ('cancel' in t.dataset) dialog.close();
    if ('showOther' in t.dataset) { commit.showOther = !commit.showOther; drawCommit(); }
    if ('commit' in t.dataset) runCommit();
    if ('finish' in t.dataset) { if (commit.result) location.reload(); else dialog.close(); }
  });
  dialog.addEventListener('change', (e) => {
    if (!('other' in e.target.dataset)) return;
    commit.other = e.target.checked;
    drawCommit();
    dialog.querySelector('[data-other]')?.focus(); // the redraw replaced it
  });
  dialog.addEventListener('input', (e) => { if ('note' in e.target.dataset) commit.note = e.target.value; });

  // ---- Claude panel ------------------------------------------------------------
  // Each chat is { id, session, log, running, status, ready, tried }: its Claude
  // conversation, its messages, whether its run is going and what it's doing,
  // the new version it made while another chat was on show, and the versions it
  // has tried. Chat 1 is always there; + opens more, up to CHATS. The open chats
  // are kept for this browser tab (the single chat from before, too, as Chat 1).
  const CHATS = 4;
  const TABS_KEY = `${hooks.key}.playground.chats`, OLD_CHAT_KEY = `${hooks.key}.playground.chat`;
  const chat = { enabled: false, notes: false, max: 1 };
  const newTab = (from = {}) => ({
    id: from?.id || `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    session: from?.session || null, log: Array.isArray(from?.log) ? from.log : [],
    running: false, status: '', ready: null, tried: new Set(),
  });
  let saved = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(TABS_KEY)) || {};
    if (!saved.tabs) { const old = JSON.parse(sessionStorage.getItem(OLD_CHAT_KEY)); if (old) saved = { tabs: [old] }; }
  } catch {}
  const tabs = (saved.tabs || []).slice(0, CHATS).filter((t, i) => t && (i === 0 || t.open || t.log?.length)).map(newTab);
  if (!tabs.length) tabs.push(newTab());
  let active = tabs[saved.activeIndex]?.id || tabs[0].id;
  const tab = () => tabs.find((t) => t.id === active);
  const keep = () => {
    try { sessionStorage.setItem(TABS_KEY, JSON.stringify({ activeIndex: tabs.indexOf(tab()), tabs: tabs.map(({ id, session, log }) => ({ id, session, log: log.slice(-200), open: true })) })); } catch {}
  };

  // Notes pinned to the app, kept in this browser only. Each is
  // { id, n, intent, comment, screen, screenTitle, params, files, playground,
  // version, node: { id: the file and line that built the widget, component: its
  // type, text }, area: [x, y, w, h] in the app's logical pixels, drag, covers
  // (an area's widgets), image (a data: URL), status, reply, created }. Status is "open"
  // (waiting in the chat box), "sent", or Claude's answer: "done", "question"
  // or "skipped". Answered notes are dropped after a week.
  const NOTES_KEY = `${hooks.key}.playground.notes`;
  const WEEK = 7 * 86400000;
  const notes = store.get(NOTES_KEY, []).filter((x) => !['done', 'skipped'].includes(x.status) || Date.now() - x.created < WEEK);
  let warnedFull = false;
  const keepNotes = () => {
    try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch {
      if (!warnedFull) toast("This browser is out of room for notes' pictures. Send or delete some notes.");
      warnedFull = true;
    }
  };
  const openNotes = () => notes.filter((x) => x.status === 'open');

  chatBody.innerHTML = `
    <div class="pg-head"><h2>Claude</h2><button type="button" data-new>New chat</button>
      <button type="button" class="pg-min" data-close aria-label="Minimise Claude" title="Minimise (P)">›</button></div>
    <div class="pg-tabs" role="tablist" aria-label="Chats"><span class="pg-tab-glider" aria-hidden="true"></span></div>
    <p class="pg-context"></p>
    <ol class="pg-log" aria-live="polite"></ol>
    <form class="pg-ask">
      <ol class="pg-notes" hidden></ol>
      <ul class="pg-shots new" hidden></ul>
      <textarea rows="4" placeholder="Describe a version to try, or a change to the one on screen" aria-label="Message to Claude"></textarea>
      <div class="pg-ask-row">
        <button type="button" class="pg-tool" data-notes aria-pressed="false" title="Pin notes to the app (N)" aria-label="Pin notes to the app">${ICON_NOTE}</button>
        <button type="button" class="pg-tool" data-capture title="Capture part of the app (or hold ⌥ and drag)" aria-label="Capture part of the app">${ICON_CAPTURE}</button>
        <button type="button" class="pg-tool" data-attach title="Attach a screenshot (or drag one in, or paste it)" aria-label="Attach a screenshot">${ICON_ATTACH}</button>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        <span class="pg-status"></span><button type="button" data-stop hidden>Stop</button><button type="submit" class="pg-use">Send</button></div>
    </form>
    <div class="pg-off" hidden></div>`;
  const logEl = chatBody.querySelector('.pg-log');
  const contextEl = chatBody.querySelector('.pg-context');
  const input = chatBody.querySelector('textarea');
  const form = chatBody.querySelector('form');
  const statusEl = chatBody.querySelector('.pg-status');
  const stopBtn = chatBody.querySelector('[data-stop]');
  const sendBtn = chatBody.querySelector('[type=submit]');
  const tabsEl = chatBody.querySelector('.pg-tabs');
  const tabGlider = tabsEl.querySelector('.pg-tab-glider');
  const newBtn = chatBody.querySelector('[data-new]');

  const shots = (images) => images?.length
    ? `<ul class="pg-shots">${images.map((src) => `<li><a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="Screenshot"></a></li>`).join('')}</ul>` : '';
  // A message's notes, with Claude's answer to each once it's in.
  const ANSWER = { sent: 'Sent', done: 'Done', question: 'Question', skipped: 'Skipped' };
  const sentNotes = (list) => list?.length ? `<ol class="pg-sent">${list.map((s) => {
    const x = notes.find((y) => y.id === s.id) || s;
    return `<li class="${esc(x.status)}"><span class="pg-pin-n">${esc(s.n)}</span><span>${esc(s.comment)}${x.status !== 'sent' && x.status !== 'open'
      ? `<em><b>${esc(ANSWER[x.status] || x.status)}</b>${x.reply ? ` · ${esc(x.reply)}` : ''}</em>` : ''}</span></li>`;
  }).join('')}</ol>` : '';
  const message = (m) => `<li class="pg-msg ${m.who}">${shots(m.images)}${m.text ? esc(m.text) : ''}${sentNotes(m.notes)}</li>`;

  const drawLog = () => {
    const { log } = tab();
    logEl.innerHTML = log.length
      ? log.map(message).join('')
      : `<li class="pg-msg note">Describe an idea for the screen on show. Claude makes it a new version, in that screen's folder, and the app reloads to try it as it's written. Follow-ups change that version. ${chat.max > 1 ? `Press + above to open another chat: up to ${chat.max} can work at the same time, each on versions of its own.` : ''} To point at something, hold ⌥ and drag over it: the capture is added here, with the widgets it covers. Screenshots can be dragged in or pasted too. To leave notes on the app, press N and click the parts to change: they wait here until you send them, all together. Claude can only change files in ${esc(hooks.data)}/.</li>`;
    logEl.scrollTop = logEl.scrollHeight;
  };
  // A new message is added on its own and rises in; the log scrolls to it. It
  // goes to the tab named (the one on show if none), and shows only if that
  // tab is on show.
  const say = (who, text, images, sent, t = tab()) => {
    const m = { who, text, ...(images?.length && { images }), ...(sent?.length && { notes: sent }) };
    t.log.push(m);
    keep();
    if (t.id !== active) return;
    if (t.log.length === 1) logEl.innerHTML = '';
    logEl.insertAdjacentHTML('beforeend', message(m));
    if (!still()) logEl.lastElementChild.classList.add('enter');
    logEl.scrollTo({ top: logEl.scrollHeight, behavior: still() ? 'auto' : 'smooth' });
  };
  const drawStatus = () => {
    const t = tab();
    statusEl.textContent = t.status;
    stopBtn.hidden = !t.running;
    sendBtn.disabled = t.running;
    newBtn.disabled = t.running || !t.log.length;
    newBtn.title = t.running ? 'Stop this chat first' : `Clear Chat ${tabs.indexOf(t) + 1} and start again`;
  };
  const setStatus = (t, status) => { t.status = status; if (t.id === active) statusEl.textContent = status; };
  const setRunning = (t, on, status = '') => {
    t.running = on;
    t.status = status;
    if (t.id === active) drawStatus();
    drawTabs();
    drawRails();
  };

  // ---- Chats --------------------------------------------------------------------
  // After the Stepper's header: the open chats in a well, a raised tile (the
  // glider) springing to the one on show, and its conversation sliding in from
  // that side. At first there's only Chat 1 and a +; each + opens the next chat,
  // up to CHATS, each a quarter of the row as if all four were open. Pointing at
  // a chat's number turns it into a ×, and clicking it closes the chat (Delete
  // does too, on the chat with the focus); not the only chat, and not while it works. Each badge says
  // how its chat is: an outline on show, solid once it has a conversation,
  // breathing blue while it works, amber with a new version waiting. A chat's
  // first message is in its tooltip.
  let tabGliderAt = null, builtFor = '', entering = null;
  const tabEl = (t) => tabsEl.querySelector(`.pg-tab[data-for="${CSS.escape(t.id)}"]`);
  const buildTabs = () => {
    for (const el of tabsEl.querySelectorAll('.pg-tab, .pg-tab-add')) el.remove();
    tabsEl.insertAdjacentHTML('beforeend', tabs.map((t, i) => `<div class="pg-tab${t.id === entering && !still() ? ' enter' : ''}" data-for="${esc(t.id)}">
        <button type="button" role="tab" class="pg-tab-btn" data-tab="${esc(t.id)}"><span class="pg-badge" data-close-tab="${esc(t.id)}"><span class="pg-badge-n">${i + 1}</span><svg class="pg-badge-x" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span><span class="pg-tab-name">Chat ${i + 1}</span><span class="pg-sr"></span></button></div>`).join('')
      + (tabs.length < CHATS ? `<button type="button" class="pg-tab-add" data-add aria-label="Open Chat ${tabs.length + 1}" title="Open Chat ${tabs.length + 1}, to run alongside"><span class="pg-badge"><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></span></button>` : ''));
    entering = null;
  };
  function drawTabs() {
    const sig = tabs.map((t) => t.id).join();
    if (sig !== builtFor) { buildTabs(); builtFor = sig; }
    tabs.forEach((t, i) => {
      const el = tabEl(t), b = el.querySelector('[data-tab]'), on = t.id === active;
      const first = t.log.find((m) => m.who === 'you')?.text?.trim();
      const state = t.running ? 'working' : t.ready ? 'new version waiting' : '';
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      el.dataset.status = on ? 'active' : t.log.length ? 'used' : 'empty';
      el.classList.toggle('running', t.running);
      el.classList.toggle('ready', !!t.ready && !t.running);
      const closable = !t.running && tabs.length > 1;
      el.classList.toggle('closable', closable);
      b.title = [`Chat ${i + 1}`, first, state, closable && 'click its number to close it (or press Delete)'].filter(Boolean).join(' · ');
      b.querySelector('.pg-sr').textContent = state ? ` (${state})` : '';
    });
    placeTabGlider();
  }
  const placeTabGlider = () => {
    const el = tabEl(tab());
    if (!el?.offsetWidth) return; // hidden: placed when it's shown
    const to = { x: el.offsetLeft, w: el.offsetWidth, h: el.offsetHeight };
    const moving = tabGliderAt && !still() && (tabGliderAt.x !== to.x || tabGliderAt.w !== to.w);
    tabGlider.style.transition = moving ? `transform 560ms ${SPRING}, width 560ms ${SPRING}, opacity 200ms ease` : 'opacity 200ms ease';
    Object.assign(tabGlider.style, { transform: `translate3d(${to.x}px, ${el.offsetTop}px, 0)`, width: `${to.w}px`, height: `${to.h}px`, opacity: '1' });
    tabGliderAt = to;
  };
  const showTab = (id, dir) => {
    const from = tabs.findIndex((t) => t.id === active), to = tabs.findIndex((t) => t.id === id);
    if (to < 0 || (to === from && !dir)) return;
    active = id;
    // The version it made while another chat was on show is tried now.
    const next = tabs[to].ready;
    tabs[to].ready = null;
    keep();
    drawTabs();
    drawLog();
    drawStatus();
    if (!still()) {
      logEl.animate([{ transform: `translateX(${(dir || Math.sign(to - from)) * 36}px)` }, { transform: 'none' }], { duration: 560, easing: SPRING });
      logEl.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
    }
    if (next) tryNew(next).then(() => draw());
  };
  const addTab = () => {
    if (tabs.length >= CHATS) return;
    const t = newTab();
    tabs.push(t);
    entering = t.id;
    showTab(t.id, 1);
    input.focus();
  };
  const closeTab = (id) => {
    const i = tabs.findIndex((t) => t.id === id);
    if (i < 0 || tabs[i].running || tabs.length === 1) return;
    tabs.splice(i, 1);
    if (id === active) showTab(tabs[Math.max(0, i - 1)].id, -1);
    else { keep(); drawTabs(); }
    drawRails();
  };
  tabsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) return addTab();
    const x = e.target.closest('.closable [data-close-tab]');
    if (x) return closeTab(x.dataset.closeTab);
    const b = e.target.closest('[data-tab]');
    if (b) showTab(b.dataset.tab);
  });
  tabsEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.closest('[data-tab]')) {
      e.preventDefault();
      closeTab(active);
      tabEl(tab())?.querySelector('[data-tab]').focus();
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || !e.target.closest('[data-tab]')) return;
    e.preventDefault();
    const n = tabs.length, i = tabs.findIndex((t) => t.id === active);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    showTab(tabs[j].id);
    tabEl(tab()).querySelector('[data-tab]').focus();
  });
  newBtn.addEventListener('click', () => {
    const t = tab();
    if (t.running) return;
    Object.assign(t, { session: null, log: [], ready: null, status: '' });
    keep();
    drawTabs();
    drawLog();
    drawStatus();
    input.focus();
  });
  addEventListener('resize', placeTabGlider);

  // What's on show, for Claude: the screen, the open folder, and the
  // exploration and version (the one being tried, or the only one in the folder).
  const context = () => {
    const p = hooks.preview();
    const folder = nav.folder || route?.screen;
    const inFolder = playgrounds.filter((x) => x.screen === folder);
    const pg = (p && byId(p.playground)) || (inFolder.length === 1 ? inFolder[0] : null);
    const where = hooks.where?.() || {};
    return {
      screen: route?.screen,
      screenTitle: where.title,
      params: where.params,
      files: where.files,
      folder,
      playground: pg?.id,
      version: pg ? trying(pg) || picked(pg) : undefined,
      versionState: pg && trying(pg) ? 'being tried, not picked' : "the prototype's pick",
    };
  };
  function drawContext() {
    if (!contextEl || !route) return;
    const c = context(), f = folderOf(c.folder), pg = c.playground && byId(c.playground);
    contextEl.innerHTML = `Working on <b>${esc(f?.title || c.folder)}</b>${pg
      ? ` › ${esc(pg.title)} › <b>${esc(versionName(pg, c.version))}</b>`
      : playgrounds.some((x) => x.screen === c.folder) ? ' (Claude picks the exploration, or asks)' : ' (a new exploration)'}`;
  }

  // Files changed: read the prototype again (once things settle), and try a
  // tab's new version the first time it shows up, with its folder open, if
  // that tab is on show. Another tab keeps it until it's opened.
  // In this app a refresh is a hot reload too: during a run its compile errors
  // are only shown in the bar (a file may be half done), and at the end of a
  // run they're said in that run's chat.
  let refreshTimer = null, pendingNew = [], pendingFinal = new Set(), pendingReload = false;
  const tryNew = async (n) => {
    const pg = byId(n.playground);
    if (!pg) return;
    nav.folder = pg.screen;
    store.set(`${hooks.key}.playground.folder`, pg.screen);
    if (pg.versions.some((v) => v.id === n.version)) await hooks.tryVersion(pg, n.version);
  };
  const changed = (event, t, final = false) => {
    pendingNew.push(...(event.new || []).map((n) => ({ ...n, tab: t })));
    if (final) pendingFinal.add(t);
    pendingReload ||= !event.reloaded;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      const fresh = pendingNew.filter((n) => !n.tab.tried.has(`${n.playground}/${n.version}`));
      const finals = [...pendingFinal], reload = pendingReload;
      pendingNew = [];
      pendingFinal = new Set();
      pendingReload = false;
      try {
        const result = await hooks.refresh({ reload });
        if (result && !result.ok) for (const f of finals) say('error', [result.message, ...(result.errors || []).slice(0, 8)].join('\n'), null, null, f);
        for (const ft of new Set(fresh.map((n) => n.tab))) {
          const mine = fresh.filter((n) => n.tab === ft);
          const next = mine.filter((n) => n.version !== 'default').at(-1) || mine.at(-1);
          ft.tried.add(`${next.playground}/${next.version}`);
          if (ft.id === active) await tryNew(next);
          else { ft.ready = next; drawTabs(); }
        }
      } catch {
        // A file half written: the next change, or the end of the run, reads it again.
      }
      draw();
    }, 300);
  };

  // One event of a run, for the tab that sent it.
  const handle = (event, run) => {
    const { t } = run;
    const sayT = (who, text) => say(who, text, null, null, t);
    if (event.type === 'attached') {
      // The server's copies outlast this page, so the log keeps those.
      const mine = [...t.log].reverse().find((m) => m.who === 'you');
      if (mine) mine.images = event.files;
    } else if (event.type === 'session') t.session = event.id;
    else if (event.type === 'text') sayT('claude', event.text);
    else if (event.type === 'tool') {
      if (/^(Editing|Writing|Running)/.test(event.label)) sayT('step', event.label);
      else setStatus(t, `${event.label}…`);
    } else if (event.type === 'refused') sayT('error', `Not allowed: ${event.label}`);
    else if (event.type === 'changed') changed(event, t);
    else if (event.type === 'done') {
      if (event.session) t.session = event.session;
      const made = (event.new || []).map((n) => `${n.playground} ${n.version}`).join(', ');
      sayT('note', [event.ok ? 'Done' : 'Stopped with an error', made && `new: ${made}`,
        event.cost != null && `$${Number(event.cost).toFixed(2)}`].filter(Boolean).join(' · '));
      changed({ new: event.new }, t, true);
    } else if (event.type === 'notes') { run.notesAnswered = true; answered(event.notes, t); }
    else if (event.type === 'error') sayT('error', event.message);
    keep();
  };

  const send = async (message, files = [], batch = []) => {
    const t = tab(), run = { t, notesAnswered: false };
    say('you', message, files.map((f) => f.url), batch.map(({ id, n, comment }) => ({ id, n, comment, status: 'sent' })), t);
    drawTabs(); // its first message names it
    setRunning(t, true, files.length || batch.length ? 'Sending…' : 'Claude is working…');
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ type: f.blob.type, data: await base64(f.blob), note: f.note })));
      const sentNotesBody = batch.map(({ status, reply, created, ...x }) => x);
      for (const x of batch) x.status = 'sent';
      keepNotes();
      drawNotes();
      const r = await fetch('/playground/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Playground': 'chat' },
        body: JSON.stringify({ message, tab: t.id, session: t.session, attachments, notes: sentNotesBody, ...context() }),
      });
      setStatus(t, 'Claude is working…');
      if (!r.ok) {
        const why = await r.json().catch(() => null);
        say('error', (why?.error || `The server said no (${r.status}).`)
          + (r.status === 409 && chat.max < 2 ? ' This server runs one chat at a time: restart serve.py to run chats side by side.' : ''), null, null, t);
        return;
      }
      const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) if (line.trim()) { try { handle(JSON.parse(line), run); } catch {} }
      }
    } catch {
      say('error', 'Lost the connection to serve.py.', null, null, t);
    } finally {
      setRunning(t, false);
      const lost = batch.filter((x) => x.status === 'sent');
      if (lost.length && !run.notesAnswered) {
        for (const x of lost) x.status = 'open';
        keepNotes();
        drawNotes();
        say('error', `The notes didn't reach Claude, so they're back above the chat box. Press Send to try again.`, null, null, t);
      }
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input.value.trim();
    const batch = openNotes();
    if ((!message && !pending.length && !batch.length) || tab().running) return;
    if (batch.length && !chat.notes) {
      // A server started before notes existed drops them without a word.
      say('error', "This server can't take notes yet: it was started before they were added. Stop it (Ctrl+C in its window) and start it again, then reload this page and press Send. Your notes are kept.");
      return;
    }
    input.value = '';
    const files = pending.splice(0);
    drawPending();
    if (noting) noteMode(false);
    closeNote();
    send(message || (batch.length ? `Work through ${batch.length === 1 ? 'this note' : `these ${batch.length} notes`}.` : 'See the screenshot.'), files, batch);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
  });

  // Pasting and dictation (VoiceInk and the like paste with ⌘V) always reach the
  // chat box. A paste made while a version, a button or the screen has the focus
  // goes into the box instead of nowhere, and a ⌘V the browser doesn't turn into
  // a paste is read from the clipboard.
  const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  const insert = (text) => {
    if (!text || !chat.enabled) return;
    if (!isOpen(chatPanel)) setOpen('chat', true);
    input.focus();
    if (!document.execCommand('insertText', false, text)) {
      input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  };
  let pasteWait = 0;
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'v' || !chat.enabled) return;
    const target = editable(e.target);
    if (target && target !== input) return;
    clearTimeout(pasteWait);
    pasteWait = setTimeout(() => navigator.clipboard?.readText().then(insert).catch(() => {}), 120);
  }, true);
  document.addEventListener('paste', (e) => {
    clearTimeout(pasteWait);
    if (!chat.enabled) return;
    const images = [...(e.clipboardData?.files || [])].filter((f) => IMAGE_TYPES.includes(f.type));
    if (images.length && (!editable(e.target) || e.target === input)) {
      e.preventDefault();
      for (const f of images) attach(f, 'Pasted');
      return;
    }
    if (editable(e.target)) return;
    e.preventDefault();
    insert(e.clipboardData?.getData('text/plain'));
  }, true);

  // ---- Screenshots -------------------------------------------------------------
  // Waiting to be sent: { blob, url, note }. A capture's note names the screen
  // and the nodes it covers, so Claude knows which part of which file it shows.
  const pending = [];
  const pendingEl = form.querySelector('.pg-shots');
  const fileInput = form.querySelector('input[type=file]');
  const base64 = (blob) => new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = fail;
    r.readAsDataURL(blob);
  });
  const drawPending = () => {
    pendingEl.hidden = !pending.length;
    pendingEl.innerHTML = pending.map((f, i) => `<li${f.fresh ? ' class="enter"' : ''}><img src="${f.url}" alt="${esc(f.label)}" title="${esc(f.note || f.label)}">
      <button type="button" data-unattach="${i}" aria-label="Remove">×</button></li>`).join('');
    for (const f of pending) f.fresh = false;
  };
  const attach = (blob, label, note = '') => {
    if (!IMAGE_TYPES.includes(blob.type)) return;
    if (pending.length >= MAX_SHOTS) { toast(`Up to ${MAX_SHOTS} screenshots a message.`); return; }
    if (!isOpen(chatPanel)) setOpen('chat', true);
    pending.push({ blob, url: URL.createObjectURL(blob), label, note, fresh: !still() });
    drawPending();
    input.focus();
  };
  pendingEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-unattach]');
    if (!b) return;
    const [f] = pending.splice(Number(b.dataset.unattach), 1);
    URL.revokeObjectURL(f.url);
    drawPending();
  });
  form.querySelector('[data-attach]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { for (const f of fileInput.files) attach(f, f.name); fileInput.value = ''; });
  // Dropping an image anywhere on the Claude panel attaches it.
  chatPanel.addEventListener('dragover', (e) => {
    if (!chat.enabled || ![...e.dataTransfer.items].some((i) => i.kind === 'file')) return;
    e.preventDefault();
    chatPanel.classList.add('drop');
  });
  chatPanel.addEventListener('dragleave', (e) => { if (!chatPanel.contains(e.relatedTarget)) chatPanel.classList.remove('drop'); });
  chatPanel.addEventListener('drop', (e) => {
    chatPanel.classList.remove('drop');
    if (!chat.enabled) return;
    e.preventDefault();
    for (const f of e.dataTransfer.files) attach(f, f.name);
  });

  // Capture: hold ⌥ and drag over any part of the app, or press the capture
  // button and drag. The area is drawn again (no screen recording
  // permission): the app draws its part at twice its real size, wherever the
  // view is scaled, and the page draws the rest at the display's.
  let aiming = false, marquee = null;
  const aim = (on) => {
    aiming = on;
    document.body.classList.toggle('pg-aiming', on);
    statusEl.textContent = on ? 'Drag over the part to capture · Esc to cancel' : tab().status;
  };
  form.querySelector('[data-capture]').addEventListener('click', () => aim(!aiming));
  addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && chat.enabled) document.body.classList.add('pg-alt');
    if (e.key === 'Escape') { if (marquee) { marquee.el.remove(); marquee = null; } if (aiming) aim(false); }
  });
  addEventListener('keyup', (e) => { if (e.key === 'Alt') document.body.classList.remove('pg-alt'); });
  addEventListener('blur', () => document.body.classList.remove('pg-alt'));
  addEventListener('pointerdown', (e) => {
    if (!chat.enabled || e.button !== 0 || !(e.altKey || aiming) || e.target.closest?.('.pg-ask')) return;
    e.preventDefault();
    e.stopPropagation();
    const el = document.createElement('div');
    el.className = 'pg-marquee';
    document.body.append(el);
    marquee = { el, x: e.clientX, y: e.clientY, rect: null };
    move(e);
  }, true);
  const move = (e) => {
    if (!marquee) return;
    const x = Math.min(marquee.x, e.clientX), y = Math.min(marquee.y, e.clientY);
    const w = Math.abs(e.clientX - marquee.x), h = Math.abs(e.clientY - marquee.y);
    marquee.rect = { x, y, w, h };
    Object.assign(marquee.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    marquee.el.dataset.size = `${Math.round(w)} × ${Math.round(h)}`;
  };
  addEventListener('pointermove', (e) => { if (marquee) { e.preventDefault(); e.stopPropagation(); move(e); } }, true);
  addEventListener('pointerup', async (e) => {
    if (!marquee) return;
    e.preventDefault();
    e.stopPropagation();
    const { el, rect } = marquee;
    marquee = null;
    aim(false);
    if (!rect || rect.w < 8 || rect.h < 8) { el.remove(); return; }
    el.classList.add('flash');
    try {
      const shot = await capture(rect);
      attach(shot.blob, 'Capture', shot.note);
    } catch (err) {
      console.error(err);
      toast("Couldn't capture that area.");
    } finally {
      setTimeout(() => el.remove(), still() ? 0 : 260);
    }
  }, true);
  // A click that ends a capture mustn't press what's under it.
  addEventListener('click', (e) => { if (e.altKey && chat.enabled && !e.target.closest?.('.pg-ask')) { e.preventDefault(); e.stopPropagation(); } }, true);

  // The host draws the capture (the app is a canvas in a frame, so the page
  // can't redraw it from the DOM) and names what it covers.
  const capture = (rect) => hooks.capture(rect);
  // ---- Notes -------------------------------------------------------------------
  // After Agentation. N (or the pin button) turns note mode on: a shield takes
  // the pointer over the app, which names the widget under it (hooks.inspect:
  // its type, and the file and line that built it), outlined here. A click
  // opens a note on that widget, and a drag one on an area; the app isn't
  // pressed. Note mode stays on, so several notes can be left in a row, until
  // N or Esc. Each note is pinned where it was left, with its number, and waits
  // in the chat box; Send takes every waiting note to Claude in one message.
  // Claude's answer shows on the pin and under the note in the chat; a "done"
  // or "skipped" note loses its pin. Pins sit on the app's window, in its
  // logical pixels, so they pan and zoom with it, but they don't follow the
  // app's own scrolling.
  const appWin = document.getElementById('window');
  const pinsEl = document.createElement('div');
  pinsEl.className = 'pg-pins';
  appWin.append(pinsEl);
  const targetEl = document.createElement('div');
  targetEl.className = 'pg-target';
  targetEl.hidden = true;
  document.body.append(targetEl);
  const popEl = document.createElement('form');
  popEl.className = 'pg-popover';
  popEl.hidden = true;
  document.body.append(popEl);
  const notesEl = form.querySelector('.pg-notes');
  const noteBtn = form.querySelector('[data-notes]');
  let noting = false, draft = null, noteDrag = null;

  const sameRoute = (x) => route && x.screen === route.screen && JSON.stringify(x.params || {}) === JSON.stringify(route.params || {});
  const nodeInfo = (hit) => hit && { id: hit.location, component: hit.widget, text: hit.text };
  const nextNumber = () => Math.max(0, ...notes.filter((x) => ['open', 'sent', 'question'].includes(x.status)).map((x) => x.n)) + 1;

  // Pins: one per note on the page on show that's waiting or unanswered.
  const drawPins = () => {
    const here = notes.filter((x) => ['open', 'sent', 'question'].includes(x.status) && sameRoute(x));
    pinsEl.innerHTML = here.map((x) => {
      const [bx, by, bw] = x.area || [0, 0, 0];
      return `<button type="button" class="pg-pin ${x.status}${draft?.id === x.id ? ' editing' : ''}" data-pin="${esc(x.id)}" style="left:${bx + bw}px;top:${by}px"
        title="${esc(`${x.n}. ${x.comment}${x.reply ? `\n${ANSWER[x.status]}: ${x.reply}` : ''}`)}">${x.n}</button>`;
    }).join('');
  };
  // The notes waiting in the chat box, in the order they go.
  const drawNotes = () => {
    const list = openNotes();
    notesEl.hidden = !list.length;
    notesEl.innerHTML = list.map((x) => `<li><button type="button" class="pg-noted" data-note="${esc(x.id)}">
        <span class="pg-pin-n">${x.n}</span><span class="pg-noted-text"><b>${esc(x.comment)}</b><small>${esc(x.screenTitle || x.screen)}${x.node ? ` · ${esc(x.node.component)}` : ''}</small></span>
      </button><button type="button" class="pg-unnote" data-unnote="${esc(x.id)}" aria-label="Delete note ${x.n}">×</button></li>`).join('');
    drawPins();
  };

  const noteMode = (on) => {
    noting = on && chat.enabled;
    document.body.classList.toggle('pg-noting', noting);
    noteBtn.setAttribute('aria-pressed', String(noting));
    targetEl.hidden = true;
    if (!tab().running) statusEl.textContent = noting ? 'Click a part of the app, or drag over an area · Esc to stop' : tab().status;
  };
  noteBtn.addEventListener('click', () => noteMode(!noting));
  addEventListener('keydown', (e) => {
    if (editable(e.target) || e.metaKey || e.ctrlKey || e.altKey || !chat.enabled) return;
    if (e.key === 'n' || e.key === 'N') { e.preventDefault(); noteMode(!noting); }
    else if (e.key === 'Escape') { if (draft) closeNote(); else if (noting) noteMode(false); }
  });

  // Which widget is under the pointer: one question to the app at a time,
  // and the latest point asked again once it's answered.
  let asking = false, nextAsk = null;
  const outline = async (x, y) => {
    nextAsk = { x, y };
    if (asking) return;
    asking = true;
    while (nextAsk) {
      const p = nextAsk;
      nextAsk = null;
      const hit = await hooks.inspect(p.x, p.y).catch(() => null);
      const show = hit && noting && !draft && !noteDrag?.el;
      targetEl.hidden = !show;
      if (show) {
        const r = hit.rect;
        Object.assign(targetEl.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
        targetEl.dataset.label = `${hit.widget} · ${hit.location.split('/').pop()}`;
      }
    }
    asking = false;
  };

  // Note mode: the shield over the app takes clicks and drags for notes.
  // ⌥ still captures, and Space still pans.
  const onApp = (e) => noting && !e.altKey && !aiming && !document.body.classList.contains('pg-space') && !!e.target.closest?.('.pg-shield');
  addEventListener('pointermove', (e) => {
    if (noteDrag) {
      e.preventDefault();
      const x = Math.min(noteDrag.x, e.clientX), y = Math.min(noteDrag.y, e.clientY);
      const w = Math.abs(e.clientX - noteDrag.x), h = Math.abs(e.clientY - noteDrag.y);
      if (!noteDrag.el && Math.max(w, h) < 6) return;
      if (!noteDrag.el) {
        noteDrag.el = document.createElement('div');
        noteDrag.el.className = 'pg-marquee note';
        document.body.append(noteDrag.el);
        targetEl.hidden = true;
      }
      noteDrag.rect = { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h };
      Object.assign(noteDrag.el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
      const [, , aw, ah] = hooks.toApp(noteDrag.rect);
      noteDrag.el.dataset.size = `${aw} × ${ah}`;
      return;
    }
    if (onApp(e) && !draft) outline(e.clientX, e.clientY);
    else targetEl.hidden = true;
  }, true);
  addEventListener('pointerdown', (e) => {
    if (!onApp(e) || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (draft) closeNote();
    noteDrag = { x: e.clientX, y: e.clientY, el: null, rect: null };
  }, true);
  addEventListener('pointerup', async (e) => {
    if (!noteDrag) return;
    e.preventDefault();
    e.stopPropagation();
    const d = noteDrag;
    noteDrag = null;
    d.el?.remove();
    if (d.el) {
      if (!d.rect || d.rect.width < 8 || d.rect.height < 8) return;
      newNote({ area: hooks.toApp(d.rect), node: null, rect: d.rect, drag: true });
    } else {
      const hit = await hooks.inspect(d.x, d.y).catch(() => null);
      if (!hit) { toast('No widget of this app there. Drag over the area instead.'); return; }
      newNote({ area: hit.area, node: nodeInfo(hit), rect: hit.rect });
    }
  }, true);
  addEventListener('click', (e) => { if (onApp(e)) { e.preventDefault(); e.stopPropagation(); } }, true);
  document.querySelector('.pg-shield')?.addEventListener('pointerleave', () => { targetEl.hidden = true; });

  // A new note: the page it's on, what's there, and a picture of it (the
  // widget or area with a little around it), taken now, while it's on show.
  // An area's picture comes with the app's list of the widgets in it.
  const newNote = ({ area, node, rect, drag = false }) => {
    const w = hooks.where?.() || {}, c = context();
    const pad = 16;
    const shotRect = { x: rect.left - pad, y: rect.top - pad, w: rect.width + 2 * pad, h: rect.height + 2 * pad };
    const picture = hooks.capture(drag ? { x: rect.left, y: rect.top, w: rect.width, h: rect.height } : shotRect)
      .then(async (s) => ({ image: `data:image/png;base64,${await base64(s.blob)}`, covers: drag ? s.note : '' }))
      .catch(() => ({}));
    openNote({
      id: `n${Date.now().toString(36)}`, n: nextNumber(), intent: 'change', comment: '', status: 'new',
      screen: route.screen, screenTitle: w.title, params: route.params, files: w.files,
      playground: c.playground, version: c.version, node, area, drag, picture,
    });
  };

  // The note's popover, beside it: what should change, and whether it's a
  // fix, a change or a question. Claude's answer shows above it.
  const openNote = (x) => {
    draft = x;
    targetEl.hidden = true;
    const isNew = x.status === 'new';
    const answer = x.reply && x.status !== 'open' ? `<p class="pg-answer ${esc(x.status)}"><b>${esc(ANSWER[x.status] || x.status)}</b> ${esc(x.reply)}</p>`
      : x.status === 'sent' ? '<p class="pg-answer sent"><b>Sent</b> No answer from Claude yet. Save it to send it again.</p>' : '';
    popEl.innerHTML = `
      <div class="pg-pop-head"><span class="pg-pin-n">${x.n}</span>${x.drag || !x.node
        ? `<b>Area</b><small>${x.area[2]} × ${x.area[3]}</small>`
        : `<b>${esc(x.node.component)}</b><small title="${esc(x.node.id)}">${esc(x.node.id.split('/').pop())}</small>`}</div>
      ${answer}
      <textarea rows="3" placeholder="What should change here?" aria-label="Note">${esc(x.comment)}</textarea>
      <div class="pg-intents" role="radiogroup" aria-label="Kind of note">${NOTE_INTENTS.map(([v, l]) =>
        `<button type="button" role="radio" data-intent="${v}" aria-checked="${x.intent === v}">${l}</button>`).join('')}</div>
      <div class="pg-pop-row">${isNew ? '' : '<button type="button" data-delete>Delete</button>'}<span></span>
        <button type="button" data-cancel>Cancel</button><button type="submit" class="pg-use">${isNew ? 'Add note' : x.status === 'open' ? 'Save' : 'Send again'}</button></div>`;
    popEl.hidden = false;
    placeNote();
    if (!still()) { popEl.classList.remove('enter'); void popEl.offsetWidth; popEl.classList.add('enter'); }
    const ta = popEl.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    drawPins();
  };
  // Beside the note's box: to its right if there's room, else its left, kept on the page.
  const placeNote = () => {
    if (!draft) return;
    const r = hooks.toClient(draft.area);
    const pw = popEl.offsetWidth, ph = popEl.offsetHeight, gap = 12;
    let left = r.right + gap;
    if (left + pw > innerWidth - 8) left = r.left - gap - pw;
    if (left < 8) left = Math.min(innerWidth - pw - 8, Math.max(8, r.left));
    const top = Math.min(innerHeight - ph - 8, Math.max(8, r.top));
    Object.assign(popEl.style, { left: `${left}px`, top: `${top}px` });
  };
  addEventListener('resize', placeNote);
  const closeNote = () => {
    if (!draft) return;
    draft = null;
    popEl.hidden = true;
    drawPins();
  };
  popEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !draft) return;
    if (b.dataset.intent) {
      draft.intent = b.dataset.intent;
      for (const r of popEl.querySelectorAll('[data-intent]')) r.setAttribute('aria-checked', String(r === b));
    } else if ('cancel' in b.dataset) closeNote();
    else if ('delete' in b.dataset) { removeNote(draft.id); closeNote(); }
  });
  popEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNote(); }
    else if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA') { e.preventDefault(); popEl.requestSubmit(); }
  });
  popEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const x = draft, comment = popEl.querySelector('textarea').value.trim();
    if (!x) return;
    if (!comment) { popEl.querySelector('textarea').focus(); return; }
    closeNote();
    x.comment = comment;
    if (x.status === 'new') {
      const { picture, ...rest } = x;
      const note = { ...rest, status: 'open', reply: '', created: Date.now() };
      notes.push(note);
      drawNotes();
      Object.assign(note, await picture);
    } else if (x.status !== 'open') {
      // Changing a sent or answered note puts it back in the chat box, to go again.
      x.status = 'open';
      x.n = nextNumber();
    }
    keepNotes();
    drawNotes();
  });
  const removeNote = (id) => {
    const i = notes.findIndex((x) => x.id === id);
    if (i >= 0) notes.splice(i, 1);
    keepNotes();
    drawNotes();
  };

  // A pin opens its note. A note in the chat box opens it too, going to its
  // page first if it's on another one.
  pinsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pin]');
    const x = b && notes.find((y) => y.id === b.dataset.pin);
    if (x) openNote(x);
  });
  notesEl.addEventListener('click', (e) => {
    const del = e.target.closest('[data-unnote]');
    if (del) return removeNote(del.dataset.unnote);
    const b = e.target.closest('[data-note]');
    const x = b && notes.find((y) => y.id === b.dataset.note);
    if (!x) return;
    if (route?.screen !== x.screen) hooks.show(x.screen, x.params);
    openNote(x);
  });
  notesEl.addEventListener('pointerover', (e) => {
    const id = e.target.closest('[data-note]')?.dataset.note;
    for (const p of pinsEl.querySelectorAll('.pg-pin')) p.classList.toggle('lit', p.dataset.pin === id);
  });
  notesEl.addEventListener('pointerleave', () => { for (const p of pinsEl.querySelectorAll('.pg-pin')) p.classList.remove('lit'); });

  // Claude's answers, from the batch's notes.json when the run ends. An answered
  // note's picture is dropped, to keep the browser's room for new ones.
  const answered = (list = [], t = tab()) => {
    const count = {};
    for (const a of list) {
      const x = notes.find((y) => y.id === a.id);
      if (!x || x.status !== 'sent') continue;
      x.status = a.status;
      x.reply = a.reply;
      if (a.status !== 'question') delete x.image;
      count[a.status] = (count[a.status] || 0) + 1;
    }
    keepNotes();
    drawNotes();
    drawLog();
    const said = Object.entries(count).map(([k, v]) => `${v} ${ANSWER[k].toLowerCase()}`).join(', ');
    if (said) say('note', `Notes: ${said}`, null, null, t);
    else if (list.length === 0) say('error', "Claude didn't answer the notes. Their pins say Sent; open one and press Send again to retry.", null, null, t);
  };
  stopBtn.addEventListener('click', () => fetch('/playground/chat/stop', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'chat' }, body: JSON.stringify({ tab: active }),
  }));
  chatBody.querySelector('[data-close]').addEventListener('click', () => setOpen('chat', false));

  // Chat is on whenever serve.py finds Claude Code. When it can't run, the panel
  // shows the one step that fixes it, with a Copy button, and looks again while
  // the page is in view, so it turns on as soon as the step is done.
  const offEl = chatBody.querySelector('.pg-off');
  const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const command = (text) => `<div class="pg-cmd"><code>${esc(text)}</code><button type="button" data-copy="${esc(text)}">Copy</button></div>`;
  const setup = {
    missing: () => `<h3>Install Claude Code to chat here</h3>
      <p>Claude makes versions of the screen on show, and the app reloads to try them as they're written. It runs on this computer with your own Claude login.</p>
      <ol><li>In Terminal, install it:${command('curl -fsSL https://claude.ai/install.sh | bash')}</li>
        <li>Run it once and log in:${command('claude')}</li></ol>
      <p class="pg-wait">This panel turns on by itself once Claude Code is installed.</p>`,
    off: (r) => `<h3>Chat is turned off</h3>
      <p>This server was started with <code>--no-chat</code>. Stop it (<kbd>Ctrl</kbd>+<kbd>C</kbd> in its window) and start it again:</p>
      ${command(`cd ${shellQuote(r.folder)} && python3 playground/serve.py`)}
      <p class="pg-wait">This panel turns on by itself once it's back.</p>`,
    server: () => `<h3>Chat needs the prototype's server</h3>
      <p>This page is served by another server, which can't run Claude, the app or save picks. Stop it, then double-click <b>Open playground.command</b> in the project's playground folder, or run this at the top of the project:</p>
      ${command('python3 playground/serve.py')}
      <p class="pg-wait">This panel turns on by itself once it's running.</p>`,
  };
  let lastWhy;
  const checkChat = async () => {
    const r = await fetch('/playground/chat', { cache: 'no-store' }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    const why = r?.enabled ? null : r?.why || 'server';
    if (why === lastWhy) return;
    const was = chat.enabled;
    lastWhy = why;
    chat.enabled = !why;
    chat.notes = !!r?.notes;
    chat.max = Math.min(CHATS, Math.max(1, Number(r?.tabs) || 1)); // a server from before chats runs one
    for (const el of [logEl, form, tabsEl, newBtn]) el.hidden = !chat.enabled;
    drawTabs();
    offEl.hidden = chat.enabled;
    if (why) offEl.innerHTML = setup[why](r);
    if (chat.enabled && was === false && lastWhy !== undefined && !still()) {
      form.classList.remove('enter'); void form.offsetWidth; form.classList.add('enter');
    }
    drawLog();
    draw(true);
  };
  offEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    navigator.clipboard?.writeText(btn.dataset.copy).then(() => {
      btn.textContent = 'Copied';
      btn.classList.add('done');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
    });
  });
  checkChat();
  setInterval(() => { if (!chat.enabled && !document.hidden) checkChat(); }, 3000);
  addEventListener('focus', () => { if (!chat.enabled) checkChat(); });

  // Both open at first; a panel you minimised stays minimised next time,
  // unless a link opens on a version (?playground=…).
  const startOpen = store.get(`${hooks.key}.playground.panels`, { files: true, chat: true });
  if (narrow()) {
    setOpen('files', !!hooks.open);
    setOpen('chat', false);
  } else {
    setOpen('files', hooks.open || startOpen.files !== false);
    setOpen('chat', hooks.open || startOpen.chat !== false);
  }
  if (hooks.open) {
    const pg = byId(hooks.preview()?.playground);
    if (pg) nav.folder = pg.screen;
  }

  // What the app's frame passes on: ⌥ held or let go, P, Esc and pastes.
  const forward = {
    key(key, down) {
      if (key === 'Alt') document.body.classList.toggle('pg-alt', down && chat.enabled);
      else if (key === 'Escape') dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      else if (key === 'n') { if (chat.enabled) noteMode(!noting); }
      else if (key === 'p') { const open = !isOpen(filesPanel) || !isOpen(chatPanel); setOpen('files', open); setOpen('chat', open); }
    },
    async paste(text, images = []) {
      if (!chat.enabled) return;
      for (const im of images) attach(await (await fetch(im.url)).blob(), 'Pasted');
      if (!images.length) insert(text);
    },
    pasteKey() {
      if (!chat.enabled) return;
      clearTimeout(pasteWait);
      pasteWait = setTimeout(() => navigator.clipboard?.readText().then(insert).catch(() => {}), 120);
    },
  };

  drawTabs();
  drawStatus();
  drawNotes();
  return { update: (r) => { route = r; draw(); drawPins(); }, forward, redraw: () => draw(true) };
};
