// The canvas's icons (src/canvas.js, composer.js, panels.js): one line
// weight, 16 px, drawn in currentColor. Part of the prototype-playground kit.

const svg = (body) => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  left: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2.2"/><path d="M6 2.5v11"/>'),
  right: svg('<rect x="1.5" y="2.5" width="13" height="11" rx="2.2"/><path d="M10 2.5v11"/>'),
  note: svg('<path d="M8 14.2s-4.4-4-4.4-7.2a4.4 4.4 0 0 1 8.8 0c0 3.2-4.4 7.2-4.4 7.2z"/><circle cx="8" cy="7" r="1.4"/>'),
  inspect: svg('<circle cx="8" cy="8" r="4.6"/><path d="M8 1.2v2.4M8 12.4v2.4M1.2 8h2.4M12.4 8h2.4"/>'),
  shot: svg('<path d="M2 5V3.2C2 2.5 2.5 2 3.2 2H5M11 2h1.8c.7 0 1.2.5 1.2 1.2V5M14 11v1.8c0 .7-.5 1.2-1.2 1.2H11M5 14H3.2C2.5 14 2 13.5 2 12.8V11"/><circle cx="8" cy="8" r="2"/>'),
  frozen: svg('<path d="M8 1.5v13M2.4 4.75l11.2 6.5M2.4 11.25l11.2-6.5M6.3 2.6 8 4.2l1.7-1.6M6.3 13.4 8 11.8l1.7 1.6"/>'),
  files: svg('<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.5 1.6H13c.7 0 1.2.5 1.2 1.2v6.3c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"/>'),
  pick: svg('<path d="M8 1.8 14.2 8 8 14.2 1.8 8z"/>'),
  reload: svg('<path d="M13.2 8A5.2 5.2 0 1 1 11.6 4.2"/><path d="M13.4 1.8v3.4H10"/>'),
  fill: svg('<path d="M9.5 2h4.5v4.5M6.5 14H2V9.5M14 2 9.2 6.8M2 14l4.8-4.8"/>'),
  branch: svg('<circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-2.4 3-5.6 4"/>'),
  main: svg('<circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v4.3M8 10.2v4.3"/>'),
  folder: svg('<path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3.2l1.5 1.6H13c.7 0 1.2.5 1.2 1.2v6.3c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z"/>'),
  clock: svg('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.5V8l2.4 1.6"/>'),
  send: svg('<path d="M8 13V3.4M3.8 7.4 8 3.2l4.2 4.2"/>'),
  stop: '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="2" fill="currentColor"/></svg>',
  plus: svg('<path d="M8 3v10M3 8h10"/>'),
  chevron: svg('<path d="M4.5 6.2 8 9.8l3.5-3.6"/>'),
  share: svg('<path d="M8 10V2.2M5 5 8 2l3 3M3 8.5v4.3c0 .7.5 1.2 1.2 1.2h7.6c.7 0 1.2-.5 1.2-1.2V8.5"/>'),
  fit: svg('<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/>'),
  external: svg('<path d="M9 2.5h4.5V7M13.3 2.7 7.5 8.5M11.5 9.5v3c0 .6-.4 1-1 1h-7c-.6 0-1-.4-1-1v-7c0-.6.4-1 1-1h3"/>'),
};
