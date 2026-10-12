// SoulGraph — panel del navegador.
// SoulGraph — browser panel.
//
// Dibuja el proyecto como una red neuronal 3D, deja filtrar, buscar, abrir y editar,
// y se actualiza solo cuando algo cambia en el disco o en Roblox Studio: lo que cambia "se dispara".
// Draws the project as a 3D neural network, lets you filter, search, open and edit,
// and updates itself whenever something changes on disk or in Roblox Studio: what changes "fires".

import { t, kindLabel, issueLabel, toggleLang, getLang } from './i18n.js';
import { h, api, toast, mix, escapeHtml, pathOf, BG, KIND_COLORS, LINK_COLORS, colorOfKind } from './util.js';
import { createInspector } from './inspector.js';

const { ForceGraph3D, THREE, UnrealBloomPass } = window.SoulVendor;

const KIND_ORDER = Object.keys(KIND_COLORS);
const LINK_TYPES = Object.keys(LINK_COLORS);
// Campos de datos que el servidor puede quitar de un nodo (el resto son de la simulación).
// Data fields the server may drop from a node (the rest belong to the simulation).
const DATA_KEYS = ['lines', 'rev', 'editable', 'symbols', 'imports', 'refs', 'calls', 'sends', 'listens', 'disabled',
  'attrs', 'tags', 'runContext', 'children', 'size', 'parent', 'class', 'ext', 'changedAt'];
const RECENT_MS = 30 * 60 * 1000; // "reciente" = últimos 30 minutos / "recent" = last 30 minutes
const FLASH_MS = 1600; // lo que dura el destello / how long the flash lasts
const MAX_ALL_LABELS = 800; // tope de etiquetas en modo "Todos" / label cap in "All" mode

// ---------- Estado / State ----------

const state = {
  version: -1,
  project: '',
  studio: { sessions: [] },
  live: false,
  nodes: new Map(),
  links: [],
  issues: [],
  neighbors: new Map(),
  hiddenSources: new Set(),
  hiddenKinds: new Set(),
  hiddenLinks: new Set(),
  onlyRecent: false,
  searchMode: 'names', // 'names' | 'code'
  query: '',
  matches: null, // ids que encajan con la búsqueda / ids matching the search
  focus: null, // ids resaltados / highlighted ids
  hoverId: null,
  selectedId: null,
  labels: readSetting('labels', 'main'), // 'off' | 'main' | 'all'
  flashes: new Map(), // id → { start, strength }
  editor: null,
  props: null,
};

const $ = (id) => document.getElementById(id);
const graphEl = $('graph');
const linkEnd = (end) => (typeof end === 'object' ? end.id : end);
const isDimmed = (id) => (state.focus && !state.focus.has(id)) || (state.matches && !state.matches.has(id));

function readSetting(key, fallback) {
  try {
    return localStorage.getItem(`soulgraph.${key}`) || fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem(`soulgraph.${key}`, value);
  } catch {
    // sin almacenamiento / no storage
  }
}

// ---------- Grafo 3D / 3D graph ----------

const Graph = ForceGraph3D({ controlType: 'orbit' })(graphEl)
  .backgroundColor(BG)
  .showNavInfo(false)
  .nodeRelSize(4)
  .nodeVal(sizeOf)
  .nodeColor(nodeColor)
  .nodeOpacity(0.95)
  .nodeResolution(12)
  .nodeLabel((n) => `<div class="tip"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(kindLabel(n.kind))} · ${escapeHtml(pathOf(n, state.nodes))}</span></div>`)
  .nodeThreeObjectExtend(true)
  .nodeThreeObject(labelGroupOf)
  .linkColor(linkColor)
  .linkOpacity(0.55)
  .linkWidth((l) => (l.type === 'contains' ? 0 : 0.7))
  // Las partículas son los "impulsos" de la red neuronal / Particles are the neural "impulses"
  .linkDirectionalParticles((l) => (l.type === 'contains' || l.type === 'calls' ? 0 : 3))
  .linkDirectionalParticleSpeed(0.005)
  .linkDirectionalParticleWidth(1.7)
  .linkDirectionalParticleColor(linkColor)
  .onNodeClick((n) => select(n.id))
  .onNodeHover((n) => {
    graphEl.style.cursor = n ? 'pointer' : '';
    state.hoverId = n ? n.id : null;
    setFocus(n ? n.id : state.selectedId);
  })
  .onBackgroundClick(() => setFocus(state.selectedId));

function nodeColor(n) {
  let color = colorOfKind(n.kind);
  if (isDimmed(n.id)) color = mix(color, BG, 0.86);
  const flash = state.flashes.get(n.id);
  if (flash) {
    const left = 1 - (performance.now() - flash.start) / FLASH_MS;
    if (left > 0) color = mix(color, '#ffffff', Math.min(1, left * flash.strength));
  }
  return color;
}

function linkColor(l) {
  const dim = isDimmed(linkEnd(l.source)) || isDimmed(linkEnd(l.target));
  return dim ? mix(LINK_COLORS[l.type], BG, 0.9) : LINK_COLORS[l.type];
}

function sizeOf(n) {
  switch (n.kind) {
    case 'root': case 'game': return 30;
    case 'service': return 10;
    case 'folder': return 4;
    case 'model': return 3;
    case 'remote': return 3;
    case 'function': return 0.8;
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
  updateLabels();
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

// ---------- Etiquetas con nombre / Name labels ----------
// Cada nodo tiene un grupo vacío; el texto solo se crea cuando hace falta enseñarlo.
// Every node has an empty group; the text is only created when it has to be shown.

const labelGroups = new Map(); // id → THREE.Group

function labelGroupOf(node) {
  let group = labelGroups.get(node.id);
  if (!group) {
    group = new THREE.Group();
    labelGroups.set(node.id, group);
    scheduleLabels(); // la librería crea los grupos cuando quiere / the library creates groups on its own schedule
  }
  return group;
}

let labelsTimer = null;
function scheduleLabels() {
  if (!labelsTimer) {
    labelsTimer = setTimeout(() => {
      labelsTimer = null;
      updateLabels();
    }, 0);
  }
}

function makeLabel(text, height) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 44px Inter, "Segoe UI", system-ui, sans-serif';
  ctx.font = font;
  canvas.width = Math.ceil(ctx.measureText(text).width) + 28;
  canvas.height = 64;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
  ctx.fill();
  ctx.fillStyle = '#c9cee3';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 14, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
  sprite.renderOrder = 10;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  return sprite;
}

function wantedLabels() {
  const wanted = new Set();
  if (state.labels === 'off') return wanted;
  const visible = Graph.graphData().nodes;
  if (state.labels === 'all') {
    visible.slice().sort((a, b) => sizeOf(b) - sizeOf(a)).slice(0, MAX_ALL_LABELS).forEach((n) => wanted.add(n.id));
  } else {
    for (const n of visible) if (n.kind === 'root' || n.kind === 'game') wanted.add(n.id);
    if (state.matches && state.matches.size <= 60) state.matches.forEach((id) => wanted.add(id));
  }
  // Lo que miras y sus vecinos siempre llevan nombre / What you look at and its neighbours always get a name
  for (const id of [state.selectedId, state.hoverId]) {
    if (!id) continue;
    wanted.add(id);
    [...(state.neighbors.get(id) || [])].slice(0, 40).forEach((n) => wanted.add(n));
  }
  return wanted;
}

function updateLabels() {
  const wanted = wantedLabels();
  for (const [id, group] of labelGroups) {
    const node = state.nodes.get(id);
    const show = Boolean(node) && wanted.has(id);
    let sprite = group.userData.sprite;
    if (show && (!sprite || group.userData.text !== node.name)) {
      if (sprite) disposeSprite(group);
      const big = ['root', 'game', 'service'].includes(node.kind);
      // Tamaño fijo en pantalla, te acerques o no / Fixed on-screen size, however close you get
      sprite = makeLabel(node.name, big ? 0.028 : 0.021);
      sprite.position.y = Math.cbrt(sizeOf(node)) * 4 + (big ? 8 : 5);
      group.add(sprite);
      group.userData = { sprite, text: node.name };
    }
    if (sprite) sprite.visible = show;
  }
}

function disposeSprite(group) {
  const { sprite } = group.userData;
  if (!sprite) return;
  group.remove(sprite);
  sprite.material.map.dispose();
  sprite.material.dispose();
  group.userData = {};
}

// ---------- Neuronas que se disparan / Firing neurons ----------
// Lo que cambia destella en blanco, sus vecinos un poco después, y salen impulsos por sus conexiones.
// What changes flashes white, its neighbours a bit later, and impulses travel along its links.

let flashTimer = null;

function fire(ids) {
  const now = performance.now();
  const links = Graph.graphData().links;
  for (const id of ids) {
    state.flashes.set(id, { start: now, strength: 1.4 });
    for (const neighbour of state.neighbors.get(id) || []) {
      if (!state.flashes.has(neighbour)) state.flashes.set(neighbour, { start: now + 350, strength: 0.6 });
    }
    for (const l of links) {
      if (linkEnd(l.source) === id || linkEnd(l.target) === id) Graph.emitParticle(l);
    }
  }
  if (!flashTimer) flashTimer = setInterval(stepFlashes, 50);
}

function stepFlashes() {
  const now = performance.now();
  for (const [id, flash] of state.flashes) if (now - flash.start > FLASH_MS) state.flashes.delete(id);
  Graph.nodeColor(Graph.nodeColor());
  if (!state.flashes.size) {
    clearInterval(flashTimer);
    flashTimer = null;
  }
}

// ---------- Datos / Data ----------

let loading = false;
let loadAgain = false;
let firstLoad = true;

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
    state.issues = data.issues || [];
    const fired = mergeNodes(data.nodes);
    state.links = data.links;
    buildNeighbors();
    computeMatches();
    renderSidebar();
    applyFilters();
    renderStatus();
    inspector.sync();
    if (!firstLoad && fired.length) fire(fired);
    firstLoad = false;
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
// Devuelve los ids que acaban de cambiar (para hacerlos "disparar").
// Reuses existing objects so nodes don't jump around on updates.
// Returns the ids that just changed (to make them "fire").
function mergeNodes(rawNodes) {
  const next = new Map();
  const fired = [];
  for (const raw of rawNodes) {
    let node = state.nodes.get(raw.id);
    if (node) {
      if (raw.changedAt && raw.changedAt !== node.changedAt) fired.push(raw.id);
      for (const key of DATA_KEYS) if (!(key in raw)) delete node[key];
      Object.assign(node, raw);
    } else {
      node = { ...raw };
      if (raw.changedAt) fired.push(raw.id);
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
  for (const [id, group] of labelGroups) {
    if (!next.has(id)) {
      disposeSprite(group);
      labelGroups.delete(id);
    }
  }
  state.nodes = next;
  return fired;
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

function isRecent(n) {
  return n.changedAt && Date.now() - n.changedAt < RECENT_MS;
}

function applyFilters() {
  let visible = [...state.nodes.values()].filter((n) => !state.hiddenSources.has(n.source) && !state.hiddenKinds.has(n.kind));
  if (state.onlyRecent) {
    // Lo reciente y lo que tiene alrededor, para no verlo flotando solo.
    // Recent nodes plus their surroundings, so they don't float alone.
    const keep = new Set();
    for (const n of visible) {
      if (!isRecent(n)) continue;
      keep.add(n.id);
      (state.neighbors.get(n.id) || []).forEach((id) => keep.add(id));
    }
    visible = visible.filter((n) => keep.has(n.id));
  }
  const ids = new Set(visible.map((n) => n.id));
  // Copias: la librería convierte source/target en objetos y queremos los ids intactos.
  // Copies: the library turns source/target into objects and we want the ids intact.
  const links = state.links
    .filter((l) => !state.hiddenLinks.has(l.type) && ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ ...l }));
  Graph.graphData({ nodes: visible, links });
  updateLabels();
  $('stats').textContent = `${visible.length} ${t('nodes')} · ${links.length} ${t('linksCount')}`;
}

// ---------- Búsqueda / Search ----------

function computeMatches() {
  if (state.searchMode !== 'names') return;
  const q = state.query;
  if (!q) {
    state.matches = null;
  } else {
    state.matches = new Set();
    for (const n of state.nodes.values()) {
      const hay = [n.name, pathOf(n, state.nodes), ...(n.symbols || [])].join('\n').toLowerCase();
      if (hay.includes(q)) state.matches.add(n.id);
    }
  }
  $('search-hint').textContent = state.matches ? t('matches', state.matches.size) : '';
}

// Búsqueda dentro del código: pregunta al servidor y lista path:línea.
// Code search: asks the server and lists path:line.
let codeTimer;
let codeRequest = 0;
async function searchCode() {
  const q = state.query;
  const box = $('code-results');
  if (!q) {
    state.matches = null;
    box.replaceChildren();
    $('search-hint').textContent = '';
    refreshStyles();
    return;
  }
  const ticket = ++codeRequest;
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&limit=200`).catch(() => null);
  if (!data || ticket !== codeRequest) return; // llegó una búsqueda más nueva / a newer search arrived

  state.matches = new Set(data.results.map((r) => r.id));
  $('search-hint').textContent = data.total ? t('codeMatches', data.results.length, data.total) : t('noResults');
  box.replaceChildren(...data.results.map((r) => h('button', { class: 'code-hit', type: 'button', onclick: () => select(r.id, { line: r.line }) },
    h('span', { class: 'where', text: `${r.name}:${r.line}` }),
    h('span', { class: 'snippet' }, highlightMatch(r.text, q)))));
  refreshStyles();
}

function highlightMatch(text, q) {
  const at = text.toLowerCase().indexOf(q);
  if (at < 0) return [text];
  return [text.slice(0, at), h('mark', { text: text.slice(at, at + q.length) }), text.slice(at + q.length)];
}

function setSearchMode(mode) {
  state.searchMode = mode;
  state.matches = null;
  $('code-results').replaceChildren();
  for (const b of document.querySelectorAll('#search-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('search').placeholder = mode === 'code' ? t('searchCode') : t('search');
  $('search').dispatchEvent(new Event('input'));
  $('search').focus();
}

for (const b of document.querySelectorAll('#search-mode button')) b.addEventListener('click', () => setSearchMode(b.dataset.mode));

$('search').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  if (state.searchMode === 'code') {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(searchCode, 250);
  } else {
    computeMatches();
    refreshStyles();
  }
});

$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.searchMode === 'names' && state.matches && state.matches.size) {
    // Primero el nombre exacto, luego el que empieza igual / Exact name first, then prefix
    const visible = new Set(Graph.graphData().nodes.map((n) => n.id));
    const rank = (id) => {
      const name = state.nodes.get(id).name.toLowerCase();
      return name === state.query ? 0 : name.startsWith(state.query) ? 1 : 2;
    };
    const first = [...state.matches].filter((id) => visible.has(id)).sort((a, b) => rank(a) - rank(b))[0];
    if (first) select(first);
  } else if (e.key === 'Enter' && state.searchMode === 'code') {
    const first = $('code-results').firstElementChild;
    if (first) first.click();
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

  $('link-filters').replaceChildren(...LINK_TYPES.filter((type) => byLink.has(type)).map((type) => filterButton({
    label: t(type),
    count: byLink.get(type),
    color: type === 'contains' ? '#5d6d94' : LINK_COLORS[type],
    shape: 'line',
    off: state.hiddenLinks.has(type),
    onClick: () => toggleIn(state.hiddenLinks, type),
  })));

  for (const b of document.querySelectorAll('#label-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.labels));
  renderRecent();
  renderHealth();
}

function renderRecent() {
  const recent = [...state.nodes.values()].filter((n) => n.changedAt).sort((a, b) => b.changedAt - a.changedAt).slice(0, 8);
  $('recent-list').replaceChildren(
    ...(recent.length ? recent.map((n) => h('button', { class: 'link-item', type: 'button', onclick: () => select(n.id) },
      h('span', { class: 'dot', style: `color:${colorOfKind(n.kind)}` }),
      h('span', { class: 'name', text: n.name }),
      h('span', { class: 'sub', text: t('ago', Math.floor((Date.now() - n.changedAt) / 60000)) })))
      : [h('p', { class: 'hint', text: t('nothingRecent') })]),
  );
  $('only-recent').setAttribute('aria-pressed', String(state.onlyRecent));
  $('only-recent').classList.toggle('off', !state.onlyRecent);
}

function renderHealth() {
  $('health-count').textContent = state.issues.length || '';
  $('health-count').classList.toggle('bad', state.issues.length > 0);
  if (!state.issues.length) {
    $('health-list').replaceChildren(h('p', { class: 'hint', text: t('healthy') }));
    return;
  }
  // Agrupado por tipo, cada grupo plegable / Grouped by type, each group collapsible
  const byType = new Map();
  for (const issue of state.issues) {
    if (!byType.has(issue.type)) byType.set(issue.type, []);
    byType.get(issue.type).push(issue);
  }
  $('health-list').replaceChildren(...[...byType].map(([type, issues]) => h('details', { class: 'issue-group' },
    h('summary', {}, h('span', { text: issueLabel(type) }), h('span', { class: 'count', text: issues.length })),
    issues.slice(0, 50).map((issue) => {
      const names = issue.ids.map((id) => state.nodes.get(id)?.name || id);
      return h('button', { class: 'link-item', type: 'button', onclick: () => select(issue.ids[0]) },
        h('span', { class: 'name', text: names.join(type === 'cycle' ? ' → ' : ', ') }),
        issue.detail ? h('span', { class: 'sub', text: issue.detail }) : null);
    }))));
}

$('only-recent').addEventListener('click', () => {
  state.onlyRecent = !state.onlyRecent;
  renderRecent();
  applyFilters();
});

for (const b of document.querySelectorAll('#label-mode button')) {
  b.addEventListener('click', () => {
    state.labels = b.dataset.mode;
    saveSetting('labels', state.labels);
    renderSidebar();
    updateLabels();
  });
}

// Los "hace X min" se ponen al día solos / The "X min ago" texts keep themselves up to date
setInterval(renderRecent, 30_000);

function renderStatus() {
  $('project-name').textContent = state.project;

  const live = $('live-pill');
  live.className = `pill ${state.live ? 'on' : 'off'}`;
  live.lastElementChild.textContent = state.live ? t('live') : t('offline');

  const sessions = (state.studio.sessions || []).filter((s) => s.connected);
  const studio = $('studio-pill');
  studio.className = `pill${sessions.length ? ' on' : ''}`;
  studio.lastElementChild.textContent = sessions.length === 0 ? t('studioOff')
    : sessions.length === 1 ? `Studio · ${sessions[0].place}` : t('studioPlaces', sessions.length);
  studio.title = sessions.length ? sessions.map((s) => s.place).join('\n') : t('studioHint');
}

function renderStaticTexts() {
  document.documentElement.lang = getLang();
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  $('search').placeholder = state.searchMode === 'code' ? t('searchCode') : t('search');
  $('lang-btn').textContent = getLang().toUpperCase();
}

$('lang-btn').addEventListener('click', () => {
  toggleLang();
  renderStaticTexts();
  renderSidebar();
  renderStatus();
  computeMatches();
  applyFilters();
  if (state.selectedId) inspector.renderMeta();
});

$('reset-btn').addEventListener('click', () => Graph.zoomToFit(800, 80));

// ---------- Selección / Selection ----------

const inspector = createInspector({ state, select, setFocus });

function select(id, { line } = {}) {
  const node = state.nodes.get(id);
  if (!node) return;
  if (id === state.selectedId) {
    if (line) inspector.goToLine(line);
    flyTo(node);
    return;
  }
  if (!inspector.confirmDiscard()) return;
  state.selectedId = id;
  setFocus(id);
  flyTo(node);
  inspector.open(node, { line });
}

// ---------- Teclado / Keyboard ----------

addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.closest('.cm-editor');
  if (e.key === '/' && !typing) {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === 'Escape' && !typing && state.selectedId) {
    inspector.close();
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
