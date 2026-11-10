// Pick and Commit on the canvas (src/canvas.js). Part of the
// prototype-playground kit.
//
// Pick, in an exploration frame's head, makes the iteration on show the one
// that goes to main for its screen (playground/…/picks.json, the classic
// playground's picks: one per screen). Commit, in the bar, is the classic
// playground's: Claude moves each pick into the app's own files, the app is
// checked, and the files the move changed are committed on this computer.
// Nothing is pushed. Only the person who looks after main should commit.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ST = { A: ['add', 'New file'], M: ['mod', 'Changed'], D: ['del', 'Deleted'], '?': ['add', 'New file'] };

/**
 * o: { data: URL of the data folder, button, toast(text), changed(picks), done() }
 */
export async function mountCommit(o) {
  let picks = {};
  const load = async () => {
    picks = await fetch(new URL('picks.json', o.data), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    drawButton();
    o.changed(picks);
  };

  async function pick(pg, v) {
    const next = { ...picks };
    if (next[pg] === v) next[pg] = 'default'; else next[pg] = v;
    const r = await fetch('/playground/picks', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'picks' }, body: JSON.stringify(next),
    }).catch(() => null);
    if (!r?.ok) { o.toast("Couldn't save the pick: is serve.py running?"); return; }
    picks = next;
    drawButton();
    o.changed(picks);
    o.toast(picks[pg] === v ? `${v.slice(1)} is picked for main. Commit moves it into the app.` : 'Not picked any more.');
  }

  const count = () => Object.values(picks).filter((v) => v && v !== 'default').length;
  function drawButton() {
    const n = count();
    o.button.innerHTML = `Commit${n ? ` <b class="cv-count">${n}</b>` : ''}${state === 'running' ? ' <i class="cv-dot"></i>' : ''}`;
    o.button.title = state === 'running' ? "Committing. Press to see how it's going." : 'Move the picked iterations into the app and commit them on this computer';
  }

  // ---- The dialog ----
  const dialog = document.createElement('dialog');
  dialog.className = 'pg-modal';
  dialog.setAttribute('aria-labelledby', 'cv-commit-title');
  document.body.append(dialog);
  let state = 'idle', info = null, steps = [], result = null, error = '', other = false, note = '', showOther = false;

  function draw() {
    const list = info?.picks || [];
    const changes = Object.entries(info?.other || {}).sort(([a], [b]) => a.localeCompare(b));
    const ready = list.length || (other && changes.length);
    let body, foot;
    if (state === 'loading') {
      body = '<p class="pg-cwait">Working out what a commit would do…</p>';
      foot = '<button type="button" data-cancel>Cancel</button>';
    } else if (state === 'unavailable') {
      body = "<p>Commits need the playground's own server. Run <code>python3 playground/serve.py</code> at the top of the project.</p>";
      foot = '<button type="button" data-cancel>Close</button>';
    } else if (state === 'running' || state === 'done' || state === 'failed') {
      body = `<ol class="pg-csteps">${steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
        ${result?.commits?.length ? `<h4>Committed to ${esc(result.branch)}</h4><ul class="pg-cdone">${result.commits.map((c) => `<li><code>${esc(c.sha)}</code> ${esc(c.message)}</li>`).join('')}</ul>
          <p class="pg-cok">Committed on this computer. Nothing was pushed: <code>git push</code> shares it.</p>` : ''}
        ${error ? `<p class="pg-cproblem">${esc(error)}</p>` : ''}
        ${state === 'running' ? "<p class=\"pg-cwait\">Working… This can take a few minutes while Claude moves the picks. Close this and carry on: the Commit button shows how it's going.</p>" : ''}`;
      foot = state === 'running' ? '<button type="button" data-cancel>Carry on</button>'
        : result?.commits?.length ? '<button type="button" data-cancel>Later</button><button type="button" class="pg-use" data-finish>Lay the canvas out again</button>'
        : '<button type="button" class="pg-use" data-cancel>Close</button>';
    } else {
      const problems = info.problems || [];
      body = `
        ${info.git ? `<p class="pg-cbranch">Commits to <b>${esc(info.branch || '?')}</b> on this computer${info.inStep?.length ? `, and moves ${info.inStep.map((b) => `<b>${esc(b)}</b>`).join(' and ')} up to it` : ''}. Nothing is pushed.</p>` : ''}
        <p class="pg-cabout">Claude moves each picked iteration into the app's own files, then the files the move changed are committed together. The main frame shows the result.</p>
        ${list.length ? `<h4>Picks</h4><ol class="pg-ccards">${list.map((p, n) => `<li class="pg-ccard">
            <div class="pg-ctitle"><span class="pg-cnum">${n + 1}</span><b>${esc(p.title)} › ${esc(p.name)}</b></div>
            <p class="pg-ctrail">${esc(p.playground)} · ${esc(p.version)}</p>${p.note ? `<p class="pg-cnote">${esc(p.note)}</p>` : ''}</li>`).join('')}</ol>`
          : '<p class="pg-cempty">Nothing is picked yet. Press <b>Pick</b> in an exploration frame\'s head to get its iteration ready for main.</p>'}
        ${changes.length ? `<div class="pg-cother">
          <label class="pg-check"><input type="checkbox" data-other ${other ? 'checked' : ''}> Also commit the ${changes.length} other change${changes.length === 1 ? '' : 's'} nobody committed</label>
          <button type="button" class="pg-link" data-show-other aria-expanded="${showOther}">${showOther ? 'Hide' : 'Show'} them</button>
          ${showOther ? `<ul class="pg-cfiles">${changes.map(([f, st]) => `<li>${ST[st] ? `<span class="pg-st ${ST[st][0]}" title="${ST[st][1]}">${esc(st)}</span>` : ''}<code title="${esc(f)}">${esc(f)}</code></li>`).join('')}</ul>` : ''}
        </div>` : ''}
        <p class="pg-cprivate">Explorations stay on this computer: the versions, their notes and the picks are never committed.</p>
        <label class="pg-cnote-label">A note for the commit <small>(optional)</small>
          <textarea data-note rows="2" placeholder="What this is and why">${esc(note)}</textarea></label>
        ${problems.length ? `<p class="pg-cproblem">Can't commit yet: ${esc(problems[0])}</p>` : ''}`;
      foot = `<button type="button" data-cancel>Cancel</button>
        <button type="button" class="pg-use" data-commit ${!ready || problems.length ? 'disabled' : ''}>${ready ? 'Commit' : 'Nothing to commit'}</button>`;
    }
    dialog.innerHTML = `<div class="pg-modal-card">
      <div class="pg-head"><h2 id="cv-commit-title">Commit to main</h2><button type="button" class="pg-min" data-cancel aria-label="Close">×</button></div>
      <div class="pg-modal-body">${body}</div>
      <div class="pg-modal-foot">${foot}</div></div>`;
  }

  async function plan() {
    state = 'loading';
    draw();
    try {
      const r = await fetch('/playground/commit', { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      info = await r.json();
      state = 'plan';
    } catch { state = 'unavailable'; }
    if (dialog.open) draw();
  }

  async function run() {
    state = 'running'; steps = []; result = null; error = '';
    dialog.close();
    drawButton();
    o.toast("Committing. Press Commit to see how it's going.");
    try {
      const r = await fetch('/playground/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Playground': 'commit' }, body: JSON.stringify({ other, note }),
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
          if (e.type === 'step') steps.push(e.text);
          if (e.type === 'done') result = e;
          if (e.type === 'error') error = e.message;
          if (dialog.open) draw();
        }
      }
      if (!error && !result) error = 'The commit stopped before it finished.';
    } catch (err) {
      error = err.message === 'Failed to fetch' ? 'Lost the connection to serve.py.' : err.message;
    }
    state = error ? 'failed' : 'done';
    drawButton();
    if (dialog.open) draw();
    if (state === 'done') { o.toast('Committed to main. Press Commit, then Lay the canvas out again, to see main as it is now.'); load(); }
    else o.toast("The commit didn't finish. Press Commit to see why.");
  }

  o.button.addEventListener('click', () => {
    if (state === 'running' || state === 'done' || state === 'failed') {
      draw();
      if (!dialog.open) dialog.showModal();
      if (state !== 'running') state = 'seen';
      return;
    }
    steps = []; result = null; error = ''; showOther = false;
    if (!dialog.open) dialog.showModal();
    plan();
  });
  addEventListener('beforeunload', (e) => { if (state === 'running') e.preventDefault(); });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) { dialog.close(); return; }
    const t = e.target.closest('button');
    if (!t) return;
    if ('cancel' in t.dataset) dialog.close();
    if ('showOther' in t.dataset) { showOther = !showOther; draw(); }
    if ('commit' in t.dataset) run();
    if ('finish' in t.dataset) o.done();
  });
  dialog.addEventListener('change', (e) => { if ('other' in e.target.dataset) { other = e.target.checked; draw(); dialog.querySelector('[data-other]')?.focus(); } });
  dialog.addEventListener('input', (e) => { if ('note' in e.target.dataset) note = e.target.value; });
  dialog.addEventListener('keydown', (e) => e.stopPropagation()); // the canvas's keys aren't for the dialog

  await load();
  return { pick, picked: (pg) => picks[pg], reload: load };
}
