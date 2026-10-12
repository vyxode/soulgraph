// SoulGraph — panel del navegador.
// SoulGraph — browser panel.
//
// Dibuja el proyecto como una red neuronal 3D, deja filtrar, abrir y editar,
// y se actualiza solo cuando algo cambia en el disco o en Roblox Studio.
// Draws the project as a 3D neural network, lets you filter, open and edit,
// and updates itself whenever something changes on disk or in Roblox Studio.

import { t, kindLabel, toggleLang, getLang } from './i18n.js';

const { ForceGraph3D, THREE, UnrealBloomPass } = window.SoulVendor;

// ---------- Paleta / Palette ----------

const BG = '#000000';
const KIND_COLORS = {
  root: '#ffffff',
  service: '#c9d1ff',
  folder: '#5d6d94',
  model: '#9d7bff',
  instance: '#7f88a8',
  server: '#3ddc97',
  client: '#4cc9f0',
  module: '#ffd166',
  code: '#ffb703',
  doc: '#f4a261',
  data: '#2ec4b6',
  image: '#f72585',
  mesh: '#c77dff',
  place: '#ff5d6c',
  audio: '#90be6d',
  other: '#6c7390',
};
const KIND_ORDER = Object.keys(KIND_COLORS);
const LINK_COLORS = { contains: '#2b3352', requires: '#ffd166', references: '#f72585' };
const LINK_TYPES = Object.keys(LINK_COLORS);
// Campos de datos que el servidor puede quitar de un nodo (el resto son de la simulación).
// Data fields the server may drop from a node (the rest belong to the simulation).
const DATA_KEYS = ['lines', 'rev', 'editable', 'symbols', 'imports', 'refs', 'disabled', 'attrs', 'tags', 'runContext', 'children', 'size', 'parent', 'class', 'ext', 'mirror'];

// ---------- Estado / State ----------

const state = {
  version: -1,
  project: '',
  studio: {},
  live: false,
  nodes: new Map(),
  links: [],
  neighbors: new Map(),
  hiddenSources: new Set(),
  hiddenKinds: new Set(),
  hiddenLinks: new Set(),
  query: '',
  matches: null, // Set de ids que encajan con la búsqueda / ids matching the search
  focus: null, // Set de ids resaltados / highlighted ids
  selectedId: null,
  editor: null,
  props: null,
};

const $ = (id) => document.getElementById(id);
const graphEl = $('graph');
const inspector = $('inspector');

// ---------- Utilidades / Utilities ----------

// Crea elementos sin innerHTML: los nombres vienen de archivos y no son de fiar.
// Builds elements without innerHTML: names come from files and aren't trusted.
function h(tag, props = {}, ...children) {
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
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mix(hexA, hexB, amount) {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const channel = (shift) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, '0')}`;
}

function formatBytes(bytes) {
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

async function api(url, { method = 'GET', body } = {}) {
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
function toast(message, bad = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('bad', bad);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function pathOf(node) {
  if (node.source === 'disk') return node.path || state.project;
  const parts = [];
  for (let n = node; n; n = state.nodes.get(n.parent)) parts.unshift(n.name);
  return parts.join('/');
}

const colorOfKind = (kind) => KIND_COLORS[kind] || KIND_COLORS.other;
const isDimmed = (id) => (state.focus && !state.focus.has(id)) || (state.matches && !state.matches.has(id));
const linkEnd = (end) => (typeof end === 'object' ? end.id : end);

// ---------- Grafo 3D / 3D graph ----------

const Graph = ForceGraph3D({ controlType: 'orbit' })(graphEl)
  .backgroundColor(BG)
  .showNavInfo(false)
  .nodeRelSize(4)
  .nodeVal(sizeOf)
  .nodeColor((n) => (isDimmed(n.id) ? mix(colorOfKind(n.kind), BG, 0.86) : colorOfKind(n.kind)))
  .nodeOpacity(0.95)
  .nodeResolution(12)
  .nodeLabel((n) => `<div class="tip"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(kindLabel(n.kind))} · ${escapeHtml(pathOf(n))}</span></div>`)
  .linkColor(linkColor)
  .linkOpacity(0.55)
  .linkWidth((l) => (l.type === 'contains' ? 0 : 0.7))
  // Las partículas son los "impulsos" de la red neuronal / Particles are the neural "impulses"
  .linkDirectionalParticles((l) => (l.type === 'contains' ? 0 : 3))
  .linkDirectionalParticleSpeed(0.005)
  .linkDirectionalParticleWidth(1.7)
  .linkDirectionalParticleColor(linkColor)
  .onNodeClick((n) => select(n.id))
  .onNodeHover((n) => {
    graphEl.style.cursor = n ? 'pointer' : '';
    setFocus(n ? n.id : state.selectedId);
  })
  .onBackgroundClick(() => setFocus(state.selectedId));

function linkColor(l) {
  const dim = isDimmed(linkEnd(l.source)) || isDimmed(linkEnd(l.target));
  return dim ? mix(LINK_COLORS[l.type], BG, 0.9) : LINK_COLORS[l.type];
}

function sizeOf(n) {
  switch (n.kind) {
    case 'root': return 30;
    case 'service': return 10;
    case 'folder': return 4;
    case 'model': return 3;
    case 'instance': return 1.2;
    default:
      if (n.lines) return 1.5 + Math.log2(1 + n.lines / 20) * 1.8;
      if (n.size) return 1.2 + Math.log10(1 + n.size / 1024);
      return 1.5;
  }
}

// El brillo (bloom) es lo que le da el aspecto de neuronas.
// The bloom is what gives it the neuron look.
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.9, 0.55, 0.12);
Graph.postProcessingComposer().addPass(bloom);
Graph.d3Force('charge').strength(-45);
Graph.d3Force('link').distance((l) => (l.type === 'contains' ? 22 : 48));

let fitted = false;
Graph.onEngineStop(() => {
  if (!fitted) {
    fitted = true;
    Graph.zoomToFit(900, 80);
  }
});

addEventListener('resize', () => {
  Graph.width(innerWidth).height(innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

function refreshStyles() {
  Graph.nodeColor(Graph.nodeColor()).linkColor(Graph.linkColor()).linkDirectionalParticleColor(Graph.linkDirectionalParticleColor());
}

function setFocus(id) {
  state.focus = id ? new Set([id, ...(state.neighbors.get(id) || [])]) : null;
  refreshStyles();
}

function flyTo(node) {
  if (node.x === undefined) return;
  const distance = 120 + sizeOf(node) * 4;
  const ratio = 1 + distance / Math.max(1, Math.hypot(node.x, node.y, node.z));
  Graph.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: node.z * ratio }, node, 900);
}

// ---------- Datos / Data ----------

let loading = false;
let loadAgain = false;

async function loadGraph() {
  if (loading) {
    loadAgain = true;
    return;
  }
  loading = true;
  try {
    const data = await api('/api/graph');
    state.version = data.version;
    state.project = data.project;
    state.studio = data.studio;
    mergeNodes(data.nodes);
    state.links = data.links;
    buildNeighbors();
    computeMatches();
    renderSidebar();
    applyFilters();
    renderStatus();
    syncInspector();
  } catch (err) {
    toast(`${t('error')}: ${err.message}`, true);
  } finally {
    loading = false;
    if (loadAgain) {
      loadAgain = false;
      loadGraph();
    }
  }
}

// Reutiliza los objetos existentes para que los nodos no salten de sitio al actualizar.
// Reuses existing objects so nodes don't jump around on updates.
function mergeNodes(rawNodes) {
  const next = new Map();
  for (const raw of rawNodes) {
    let node = state.nodes.get(raw.id);
    if (node) {
      for (const key of DATA_KEYS) if (!(key in raw)) delete node[key];
      Object.assign(node, raw);
    } else {
      node = { ...raw };
      // Los nodos nuevos nacen junto a su padre / New nodes are born next to their parent
      const parent = next.get(raw.parent) || state.nodes.get(raw.parent);
      if (parent && parent.x !== undefined) {
        node.x = parent.x + (Math.random() - 0.5) * 30;
        node.y = parent.y + (Math.random() - 0.5) * 30;
        node.z = parent.z + (Math.random() - 0.5) * 30;
      }
    }
    next.set(raw.id, node);
  }
  state.nodes = next;
}

function buildNeighbors() {
  state.neighbors = new Map();
  const add = (a, b) => {
    if (!state.neighbors.has(a)) state.neighbors.set(a, new Set());
    state.neighbors.get(a).add(b);
  };
  for (const l of state.links) {
    add(l.source, l.target);
    add(l.target, l.source);
  }
}

function applyFilters() {
  const visible = [...state.nodes.values()].filter((n) => !state.hiddenSources.has(n.source) && !state.hiddenKinds.has(n.kind));
  const ids = new Set(visible.map((n) => n.id));
  // Copias: la librería convierte source/target en objetos y queremos los ids intactos.
  // Copies: the library turns source/target into objects and we want the ids intact.
  const links = state.links
    .filter((l) => !state.hiddenLinks.has(l.type) && ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ ...l }));
  Graph.graphData({ nodes: visible, links });
  $('stats').textContent = `${visible.length} ${t('nodes')} · ${links.length} ${t('linksCount')}`;
}

// ---------- Búsqueda / Search ----------

function computeMatches() {
  const q = state.query;
  if (!q) {
    state.matches = null;
  } else {
    state.matches = new Set();
    for (const n of state.nodes.values()) {
      const hay = [n.name, pathOf(n), ...(n.symbols || [])].join('\n').toLowerCase();
      if (hay.includes(q)) state.matches.add(n.id);
    }
  }
  $('search-hint').textContent = state.matches ? t('matches', state.matches.size) : '';
}

$('search').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  computeMatches();
  refreshStyles();
});

$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.matches && state.matches.size) {
    // Primero el nombre exacto, luego el que empieza igual / Exact name first, then prefix
    const visible = new Set(Graph.graphData().nodes.map((n) => n.id));
    const rank = (id) => {
      const name = state.nodes.get(id).name.toLowerCase();
      return name === state.query ? 0 : name.startsWith(state.query) ? 1 : 2;
    };
    const first = [...state.matches].filter((id) => visible.has(id)).sort((a, b) => rank(a) - rank(b))[0];
    if (first) select(first);
  }
  if (e.key === 'Escape') {
    e.target.value = '';
    e.target.dispatchEvent(new Event('input'));
  }
});

// ---------- Barra lateral / Sidebar ----------

function filterButton({ label, count, color, off, shape = 'dot', onClick }) {
  return h('button', { class: `filter${off ? ' off' : ''}`, type: 'button', onclick: onClick, 'aria-pressed': String(!off) },
    h('span', { class: shape, style: `color:${color}` }),
    h('span', { class: 'label', text: label }),
    h('span', { class: 'count', text: count }));
}

function toggleIn(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
  renderSidebar();
  applyFilters();
}

function renderSidebar() {
  const counts = (fn) => {
    const map = new Map();
    for (const n of state.nodes.values()) map.set(fn(n), (map.get(fn(n)) || 0) + 1);
    return map;
  };
  const bySource = counts((n) => n.source);
  const byKind = counts((n) => n.kind);
  const byLink = new Map();
  for (const l of state.links) byLink.set(l.type, (byLink.get(l.type) || 0) + 1);

  $('source-filters').replaceChildren(...['disk', 'studio'].map((source) => filterButton({
    label: t(source),
    count: bySource.get(source) || 0,
    color: source === 'disk' ? '#ffffff' : KIND_COLORS.service,
    off: state.hiddenSources.has(source),
    onClick: () => toggleIn(state.hiddenSources, source),
  })));

  $('kind-filters').replaceChildren(...KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => filterButton({
    label: kindLabel(kind),
    count: byKind.get(kind),
    color: colorOfKind(kind),
    off: state.hiddenKinds.has(kind),
    onClick: () => toggleIn(state.hiddenKinds, kind),
  })));

  $('link-filters').replaceChildren(...LINK_TYPES.map((type) => filterButton({
    label: t(type),
    count: byLink.get(type) || 0,
    color: type === 'contains' ? '#5d6d94' : LINK_COLORS[type],
    shape: 'line',
    off: state.hiddenLinks.has(type),
    onClick: () => toggleIn(state.hiddenLinks, type),
  })));
}

function renderStatus() {
  $('project-name').textContent = state.project;

  const live = $('live-pill');
  live.className = `pill ${state.live ? 'on' : 'off'}`;
  live.lastElementChild.textContent = state.live ? t('live') : t('offline');

  const studio = $('studio-pill');
  const connected = state.studio && state.studio.connected;
  studio.className = `pill${connected ? ' on' : ''}`;
  studio.lastElementChild.textContent = connected ? `Studio · ${state.studio.place || ''}` : t('studioOff');
  studio.title = connected ? state.studio.place || '' : t('studioHint');
}

function renderStaticTexts() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('search').placeholder = t('search');
  $('lang-btn').textContent = getLang().toUpperCase();
}

$('lang-btn').addEventListener('click', () => {
  toggleLang();
  renderStaticTexts();
  renderSidebar();
  renderStatus();
  computeMatches();
  applyFilters();
  if (state.selectedId) renderInspectorMeta();
});

$('reset-btn').addEventListener('click', () => Graph.zoomToFit(800, 80));

// ---------- Inspector ----------

function select(id) {
  const node = state.nodes.get(id);
  if (!node || !confirmDiscard()) return;
  state.selectedId = id;
  setFocus(id);
  flyTo(node);
  openInspector(node);
}

function confirmDiscard() {
  const dirty = (state.editor && state.editor.dirty) || (state.props && state.props.dirty);
  return !dirty || window.confirm(getLang() === 'es' ? '¿Descartar los cambios sin guardar?' : 'Discard unsaved changes?');
}

function closeInspector() {
  if (!confirmDiscard()) return;
  state.selectedId = null;
  state.editor = null;
  state.props = null;
  inspector.hidden = true;
  setFocus(null);
}

// El inspector tiene dos partes: la cabecera/conexiones (se redibujan con cada cambio)
// y el contenido editable (se conserva para no perder lo que estás escribiendo).
// The inspector has two parts: header/connections (redrawn on every change)
// and the editable content (kept so you don't lose what you're typing).
function openInspector(node) {
  state.editor = null;
  state.props = null;
  inspector.hidden = false;
  inspector.replaceChildren(
    h('div', { class: 'insp-head', id: 'insp-head' }),
    h('div', { class: 'insp-body' },
      h('section', { id: 'insp-content' }),
      h('div', { id: 'insp-meta' })),
  );
  renderInspectorMeta();
  renderContent(node);
}

function renderInspectorMeta() {
  const node = state.nodes.get(state.selectedId);
  if (!node) return;
  const color = colorOfKind(node.kind);

  const chips = [
    kindLabel(node.kind),
    t(node.source),
    node.source === 'studio' && node.class !== kindLabel(node.kind) ? node.class : null,
    node.lines != null ? `${node.lines} ${t('lines')}` : null,
    node.size != null ? formatBytes(node.size) : null,
    node.disabled ? 'Disabled' : null,
  ].filter(Boolean);

  const actions = [];
  if (node.source === 'studio') {
    actions.push(h('button', { class: 'btn', type: 'button', text: t('openInStudio'), onclick: () => studioCommand({ type: 'open', id: node.id }) }));
  } else {
    actions.push(h('button', {
      class: 'btn',
      type: 'button',
      text: t('copyPath'),
      onclick: () => navigator.clipboard.writeText(pathOf(node)).then(() => toast(t('copied'))),
    }));
  }

  $('insp-head').replaceChildren(
    h('div', { class: 'insp-title' },
      h('span', { class: 'dot', style: `color:${color}` }),
      h('h1', { text: node.name }),
      h('button', { class: 'icon-btn', type: 'button', title: t('close'), 'aria-label': t('close'), onclick: closeInspector, text: '✕' })),
    h('p', { class: 'insp-path', text: pathOf(node) }),
    h('div', { class: 'chips' }, chips.map((c) => h('span', { class: 'chip', text: c }))),
    h('div', { class: 'actions' }, actions),
  );

  $('insp-meta').replaceChildren(...metaSections(node));
}

function metaSections(node) {
  const sections = [];
  const id = node.id;

  if (node.symbols && node.symbols.length) {
    sections.push(h('section', {},
      h('h3', { text: `${t('defines')} (${node.symbols.length})` }),
      h('div', { class: 'chips' }, node.symbols.slice(0, 80).map((s) => h('button', {
        class: 'chip',
        type: 'button',
        text: s,
        onclick: () => {
          $('search').value = s;
          $('search').dispatchEvent(new Event('input'));
        },
      })))));
  }

  const out = (type) => state.links.filter((l) => l.type === type && l.source === id).map((l) => l.target);
  const into = (type) => state.links.filter((l) => l.type === type && l.target === id).map((l) => l.source);

  const groups = [
    [t('uses'), out('requires')],
    [t('usedBy'), into('requires')],
    [t('mentions'), out('references')],
    [t('mentionedBy'), into('references')],
    [t('inside'), node.parent ? [node.parent] : []],
    [t('children'), out('contains')],
  ];

  for (const [title, ids] of groups) {
    const nodes = ids.map((x) => state.nodes.get(x)).filter(Boolean);
    if (!nodes.length) continue;
    const shown = nodes.slice(0, 60);
    sections.push(h('section', {},
      h('h3', { text: `${title} (${nodes.length})` }),
      h('div', { class: 'links-list' },
        shown.map((n) => h('button', { class: 'link-item', type: 'button', onclick: () => select(n.id) },
          h('span', { class: 'dot', style: `color:${colorOfKind(n.kind)}` }),
          h('span', { class: 'name', text: n.name }),
          h('span', { class: 'sub', text: kindLabel(n.kind) }))),
        nodes.length > shown.length ? h('span', { class: 'sub', text: `+${nodes.length - shown.length}` }) : null)));
  }
  return sections;
}

function renderContent(node) {
  const box = $('insp-content');
  const isScript = ['server', 'client', 'module'].includes(node.kind);

  if (node.editable || (node.source === 'studio' && isScript)) {
    box.replaceChildren(h('p', { class: 'empty', text: '…' }));
    loadEditor(node);
  } else if (node.source === 'studio') {
    box.replaceChildren(propsForm(node));
  } else if (node.kind === 'image') {
    box.replaceChildren(h('img', { class: 'preview', alt: node.name, src: `/api/raw?id=${encodeURIComponent(node.id)}&v=${node.rev}` }));
  } else if (node.source === 'disk' && node.kind !== 'folder' && node.kind !== 'root') {
    box.replaceChildren(h('p', { class: 'empty', text: node.lines === undefined && node.size > 0 ? t('notEditable') : '' }));
  } else {
    box.replaceChildren();
  }
}

// ---------- Editor de código / Code editor ----------

async function loadEditor(node) {
  let data;
  try {
    data = await api(`/api/node?id=${encodeURIComponent(node.id)}`);
  } catch (err) {
    $('insp-content').replaceChildren(h('p', { class: 'empty', text: err.message }));
    return;
  }
  if (state.selectedId !== node.id) return; // ya se eligió otro nodo / another node was picked meanwhile
  if (data.content === undefined) {
    $('insp-content').replaceChildren(h('p', { class: 'empty', text: t('notEditable') }));
    return;
  }

  const banner = h('div', { class: 'banner', hidden: true });
  const textarea = h('textarea', { spellcheck: false, value: data.content, 'aria-label': node.name });
  const status = h('span', { class: 'editor-state' });
  const saveBtn = h('button', { class: 'btn primary', type: 'button', text: t('save'), onclick: () => saveEditor() });

  state.editor = { id: node.id, base: data.base, original: data.content, dirty: false, textarea, status, saveBtn, banner };

  textarea.addEventListener('input', updateDirty);
  textarea.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveEditor();
    } else if (e.key === 'Tab' && !e.shiftKey) {
      // Tab escribe un tabulador en vez de saltar de campo / Tab types a tab instead of moving focus
      e.preventDefault();
      textarea.setRangeText('\t', textarea.selectionStart, textarea.selectionEnd, 'end');
      updateDirty();
    }
  });

  $('insp-content').replaceChildren(h('div', { class: 'editor' },
    banner,
    textarea,
    h('div', { class: 'editor-bar' }, status, saveBtn)));
  updateDirty();
}

function updateDirty() {
  const ed = state.editor;
  if (!ed) return;
  ed.dirty = ed.textarea.value !== ed.original;
  ed.status.textContent = ed.dirty ? `● ${t('unsaved')}` : '';
  ed.status.classList.toggle('dirty', ed.dirty);
  ed.saveBtn.disabled = !ed.dirty;
}

async function saveEditor() {
  const ed = state.editor;
  if (!ed || !ed.dirty) return;
  ed.status.textContent = t('saving');
  const content = ed.textarea.value;
  try {
    const res = await api('/api/save', { method: 'POST', body: { id: ed.id, content, base: ed.base } });
    ed.base = res.base;
    ed.original = content;
    ed.banner.hidden = true;
    updateDirty();
    toast(t('saved'));
  } catch (err) {
    updateDirty();
    if (err.status === 409) showConflict(err.data.content, err.data.base);
    else toast(`${t('error')}: ${err.message}`, true);
  }
}

// Alguien cambió el archivo mientras editabas: tú eliges qué versión gana.
// Someone changed the file while you were editing: you choose which version wins.
function showConflict(remoteContent, remoteBase) {
  const ed = state.editor;
  if (!ed) return;
  ed.banner.hidden = false;
  ed.banner.replaceChildren(
    h('span', { text: t('changedOutside') }),
    h('button', {
      class: 'btn',
      type: 'button',
      text: t('reload'),
      onclick: () => {
        ed.textarea.value = remoteContent ?? '';
        ed.original = ed.textarea.value;
        ed.base = remoteBase;
        ed.banner.hidden = true;
        updateDirty();
      },
    }),
    h('button', {
      class: 'btn',
      type: 'button',
      text: t('overwrite'),
      onclick: () => {
        ed.base = remoteBase;
        ed.banner.hidden = true;
        saveEditor();
      },
    }),
  );
}

// Llamado tras cada actualización del grafo / Called after every graph update
async function syncInspector() {
  if (!state.selectedId) return;
  const node = state.nodes.get(state.selectedId);
  if (!node) {
    state.editor = null;
    state.props = null;
    closeInspector();
    return;
  }
  renderInspectorMeta();

  const ed = state.editor;
  if (ed && node.rev !== undefined && node.rev !== ed.base) {
    const data = await api(`/api/node?id=${encodeURIComponent(node.id)}`).catch(() => null);
    if (!data || state.editor !== ed || data.content === undefined) return;
    if (data.content === ed.textarea.value) {
      ed.base = data.base;
      ed.original = data.content;
      updateDirty();
    } else if (!ed.dirty) {
      // Cambio de fuera y no tocaste nada: se actualiza en vivo sin perder la posición.
      // Outside change and you didn't touch anything: update live keeping your position.
      const { scrollTop, selectionStart, selectionEnd } = ed.textarea;
      ed.textarea.value = data.content;
      ed.textarea.setSelectionRange(selectionStart, selectionEnd);
      ed.textarea.scrollTop = scrollTop;
      ed.original = data.content;
      ed.base = data.base;
      updateDirty();
    } else {
      showConflict(data.content, data.base);
    }
  } else if (!ed && node.source === 'studio' && !(state.props && state.props.dirty)) {
    if (['server', 'client', 'module'].includes(node.kind)) {
      if (!$('insp-content').querySelector('textarea')) renderContent(node);
    } else {
      $('insp-content').replaceChildren(propsForm(node));
    }
  }
}

// ---------- Propiedades de Studio / Studio properties ----------

function propsForm(node) {
  const form = h('form', { class: 'props' });
  state.props = { id: node.id, dirty: false };
  const markDirty = () => { state.props.dirty = true; };

  const nameInput = h('input', { type: 'text', value: node.name, oninput: markDirty });
  form.append(h('label', { text: t('name') }), nameInput);

  const attrInputs = [];
  for (const [key, attr] of Object.entries(node.attrs || {})) {
    const type = attr && attr.type;
    let input;
    if (type === 'boolean') input = h('input', { type: 'checkbox', checked: attr.value === true, onchange: markDirty });
    else if (type === 'number') input = h('input', { type: 'number', step: 'any', value: attr.value, oninput: markDirty });
    else if (type === 'string') input = h('input', { type: 'text', value: attr.value, oninput: markDirty });
    else input = h('span', { class: 'readonly', text: `${attr && attr.value} (${type})` });
    form.append(h('label', { text: key }), input);
    if (input.tagName === 'INPUT') attrInputs.push([key, type, input]);
  }

  if (node.tags) {
    form.append(h('label', { text: t('tags') }), h('span', { class: 'readonly', text: node.tags.join(', ') }));
  }

  const apply = h('button', { class: 'btn primary', type: 'submit', text: t('applyChanges') });
  form.append(h('span'), h('div', { class: 'actions' }, apply));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const attrs = {};
    for (const [key, type, input] of attrInputs) {
      if (type === 'boolean') attrs[key] = input.checked;
      else if (type === 'number') attrs[key] = Number(input.value);
      else attrs[key] = input.value;
    }
    const ok = await studioCommand({ type: 'props', id: node.id, name: nameInput.value, attrs });
    if (ok) state.props.dirty = false;
  });

  return h('section', {}, h('h3', { text: t('attributes') }), form);
}

async function studioCommand(body) {
  try {
    await api('/api/studio/command', { method: 'POST', body });
    toast('✓');
    return true;
  } catch (err) {
    toast(err.status === 503 ? t('needsStudio') : `${t('error')}: ${err.message}`, true);
    return false;
  }
}

// ---------- Teclado / Keyboard ----------

addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === 'Escape' && !typing && state.selectedId) {
    closeInspector();
  }
});

addEventListener('beforeunload', (e) => {
  if ((state.editor && state.editor.dirty) || (state.props && state.props.dirty)) e.preventDefault();
});

// ---------- Tiempo real / Real time ----------

let loadTimer;
function connectEvents() {
  const events = new EventSource('/api/events');
  events.addEventListener('graph', (e) => {
    const { version } = JSON.parse(e.data);
    if (version === state.version) return;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(loadGraph, 120);
  });
  events.addEventListener('status', (e) => {
    state.studio = JSON.parse(e.data);
    renderStatus();
  });
  events.onopen = () => {
    state.live = true;
    renderStatus();
  };
  events.onerror = () => {
    state.live = false;
    renderStatus();
  };
}

renderStaticTexts();
renderStatus();
connectEvents();
