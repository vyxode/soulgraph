// Utilidades y paleta compartidas por el panel.
// Utilities and palette shared by the panel.

export const BG = '#000000';

// Un color por tipo de nodo / One color per node kind
export const KIND_COLORS = {
  root: '#ffffff',
  game: '#e6e9ff',
  service: '#c9d1ff',
  folder: '#5d6d94',
  model: '#9d7bff',
  group: '#b9a6ff',
  instance: '#7f88a8',
  server: '#3ddc97',
  client: '#4cc9f0',
  module: '#ffd166',
  function: '#fff1c2',
  remote: '#ff6b35',
  code: '#ffb703',
  doc: '#f4a261',
  data: '#2ec4b6',
  image: '#f72585',
  mesh: '#c77dff',
  place: '#ff5d6c',
  audio: '#90be6d',
  other: '#6c7390',
};

export const LINK_COLORS = {
  contains: '#2b3352',
  requires: '#ffd166',
  calls: '#fff1c2',
  signal: '#ff6b35',
  references: '#f72585',
};

export const colorOfKind = (kind) => KIND_COLORS[kind] || KIND_COLORS.other;
export const SCRIPT_KINDS = new Set(['server', 'client', 'module']);

// Crea elementos sin innerHTML: los nombres vienen de archivos y no son de fiar.
// Builds elements without innerHTML: names come from files and aren't trusted.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Mezcla dos colores hex (amount 0 = a, 1 = b) / Mixes two hex colors (amount 0 = a, 1 = b)
export function mix(hexA, hexB, amount) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const channel = (shift) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

export function formatBytes(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

let toastTimer;
export function toast(message, bad = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// Ruta legible, igual que la del servidor (src/graph.js) / Readable path, same as the server's (src/graph.js)
export function pathOf(node, nodes) {
  if (!node) return '';
  if (node.kind === 'function') return `${pathOf(nodes.get(node.parent), nodes)}#${node.name}`;
  if (node.source === 'disk') return node.path || node.name;
  const parts = [];
  for (let n = node; n; n = nodes.get(n.parent)) parts.unshift(n.name);
  return parts.join('/');
}
