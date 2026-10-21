// The prototype-playground kit: the bridge between this app and the playground page
// (playground/README.md), which runs it in a frame with ?playground=<its
// origin>. Opened any other way, it does nothing.
//
// lib/playground/bridge_web.dart talks through window.playgroundBridge: JSON
// strings, only to and from the playground's own origin. It also passes on
// what the playground needs while the app has the focus: ⌥ (to capture),
// P (the panels), N (notes), Esc, Space (to pan the canvas), the canvas's zoom (⌘+, ⌘−,
// ⌘0, ⇧1, pinch and ⌘-scroll), and pastes and ⌘V outside the app's own text
// fields, which go to the Claude panel's chat box.
(() => {
  const host = new URLSearchParams(location.search).get('playground');
  if (!host || window.parent === window) return;
  let origin;
  try { origin = new URL(host).origin; } catch { return; }
  const listeners = [];
  const post = (m) => window.parent.postMessage(m, origin);
  window.playgroundBridge = {
    embedded: true,
    post: (s) => post(s),
    listen: (fn) => listeners.push(fn),
  };
  addEventListener('message', (e) => {
    if (e.origin !== origin || e.source !== window.parent || typeof e.data !== 'string') return;
    for (const fn of listeners) fn(e.data);
  });

  const send = (m) => post(JSON.stringify({ ...m, from: 'page' }));
  const editable = (el) => el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  addEventListener('keydown', (e) => {
    const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
    const zoom = mod && (e.key === '=' || e.key === '+') ? 'in' : mod && (e.key === '-' || e.key === '_') ? 'out'
      : mod && e.key === '0' ? 'actual' : e.shiftKey && e.code === 'Digit1' && !editable(e.target) ? 'fit' : null;
    if (zoom) { e.preventDefault(); e.stopPropagation(); send({ type: 'zoomkey', key: zoom }); return; }
    if (e.code === 'Space' && !editable(e.target)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) send({ type: 'key', key: 'Space', down: true }); return; }
    if (e.key === 'Alt') send({ type: 'key', key: 'Alt', down: true });
    else if (e.key === 'Escape') send({ type: 'key', key: 'Escape', down: true });
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'p', down: true });
    else if ((e.key === 'n' || e.key === 'N') && !e.metaKey && !e.ctrlKey && !e.altKey && !editable(e.target)) send({ type: 'key', key: 'n', down: true });
    else if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'v' && !editable(e.target)) send({ type: 'pastekey' });
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
  addEventListener('paste', async (e) => {
    if (editable(e.target)) return;
    e.preventDefault();
    const images = await Promise.all([...(e.clipboardData?.files || [])]
      .filter((f) => /^image\/(png|jpeg|webp|gif)$/.test(f.type))
      .map((f) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok({ type: f.type, url: r.result }); r.readAsDataURL(f); })));
    send({ type: 'paste', text: e.clipboardData?.getData('text/plain') || '', images });
  }, true);
})();
