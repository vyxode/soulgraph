// Iconos por tipo de nodo (trazo fino, 24×24), coloreados con el color del tipo.
// Icons per node kind (thin stroke, 24×24), tinted with the kind's color.

const PATHS = {
  root: 'M12 2c.6 6 4 9.4 10 10-6 .6-9.4 4-10 10-.6-6-4-9.4-10-10 6-.6 9.4-4 10-10z',
  game: 'M12 2c.6 6 4 9.4 10 10-6 .6-9.4 4-10 10-.6-6-4-9.4-10-10 6-.6 9.4-4 10-10z',
  service: 'M4 6h16M4 12h16M4 18h16',
  folder: 'M3 7h7l2 2h9v10H3z',
  model: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  group: 'M8 4l8 4.5v9M4 8l8 4.5v9l-8-4.5zM12 12.5l8-4.5',
  instance: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  server: 'M4 4h16v7H4zM4 13h16v7H4zM8 7.5h.01M8 16.5h.01',
  client: 'M3 5h18v11H3zM8 20h8M12 16v4',
  module: 'M8 4H6a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2',
  function: 'M14 4c-3 0-3 3-3.5 8S9 20 6 20M8 11h7',
  remote: 'M13 2L4 14h7l-1 8 9-12h-7z',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  doc: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01',
  mesh: 'M12 3l8 5v8l-8 5-8-5V8zM4 8l8 5 8-5M12 13v8',
  place: 'M5 3h14v18H5zM9 8h6M9 12h6',
  audio: 'M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM19 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  other: 'M6 3h9l4 4v14H6z',
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(kind, color) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  if (color) svg.style.color = color;
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[kind] || PATHS.other);
  // Las estrellas (proyecto, lugar) van rellenas / Stars (project, place) are filled
  if (kind === 'root' || kind === 'game') path.setAttribute('fill', 'currentColor');
  svg.append(path);
  return svg;
}
