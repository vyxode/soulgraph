// SoulGraph — panel del navegador.
// SoulGraph — browser panel.
//
// Carga el grafo, decide qué se ve (filtros, búsqueda, grupos) y conecta la barra lateral,
// la vista 3D (view.js) y el inspector (inspector.js). Se actualiza solo en tiempo real.
// Loads the graph, decides what is visible (filters, search, groups) and wires the sidebar,
// the 3D view (view.js) and the inspector (inspector.js). Updates itself in real time.

import { t, kindLabel, issueLabel, toggleLang, getLang } from './i18n.js';
import { h, api, toast, pathOf, KIND_COLORS, LINK_COLORS, colorOfKind } from './util.js';
import { icon } from './icons.js';
import { createView } from './view.js';
import { createInspector } from './inspector.js';

const KIND_ORDER = Object.keys(KIND_COLORS);
const LINK_TYPES = Object.keys(LINK_COLORS);
// Campos de datos que el servidor puede quitar de un nodo (el resto son de la simulación).
// Data fields the server may drop from a node (the rest belong to the simulation).
const DATA_KEYS = ['lines', 'rev', 'editable', 'symbols', 'imports', 'refs', 'calls', 'sends', 'listens', 'disabled',
  'attrs', 'tags', 'runContext', 'children', 'size', 'parent', 'class', 'ext', 'changedAt'];
const RECENT_MS = 30 * 60 * 1000; // "reciente" = últimos 30 minutos / "recent" = last 30 minutes
const GROUP_MIN = 8; // a partir de aquí, los modelos hermanos se juntan en un nodo / from here, sibling models merge into one node
const GROUPABLE = new Set(['model', 'instance']);
const MIN_LOADER_MS = 1400; // para que la animación de entrada se vea entera / so the intro animation plays fully

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
  hiddenKinds: new Set(['function']), // las funciones aparecen al abrir su módulo / functions appear when their module is open
  hiddenLinks: new Set(),
  expanded: new Set(), // contenedores con sus modelos desplegados / containers with their models expanded
  groups: new Map(), // id → nodo de grupo (se conserva para que no salte) / group node (kept so it doesn't jump)
  onlyRecent: false,
  searchMode: 'names',
  query: '',
  matches: null,
  focus: null,
  hoverId: null,
  selectedId: null,
  labels: readSetting('labels', 'main'),
  flashes: new Map(),
  editor: null,
  props: null,
};

const $ = (id) => document.getElementById(id);
const startedAt = performance.now();

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

// ---------- Vista e inspector / View and inspector ----------

const view = createView({
  el: $('graph'),
  state,
  onNodeClick: (n) => (n.kind === 'group' ? expandGroup(n) : select(n.id)),
  onHover: (n) => {
    state.hoverId = n ? n.id : null;
    setFocus(n ? n.id : state.selectedId);
  },
  // Ni bajando la resolución llega a ~30 FPS: pasamos a efectos ligeros y te lo decimos.
  // Even at lower resolution it can't reach ~30 FPS: switch to light effects and tell you.
  onTooSlow: () => {
    view.setQuality('low');
    renderToolbar();
    toast(t('autoLow'));
  },
});

const inspector = createInspector({ state, select, setFocus, regroup });

// Calidad: la elegida por ti, o una estimación según el ordenador.
// Quality: the one you picked, or an estimate based on the computer.
const userQuality = readSetting('quality', null);
view.setQuality(userQuality || guessQuality());

function guessQuality() {
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const webgl2 = Boolean(document.createElement('canvas').getContext('webgl2'));
  return cores <= 4 || memory <= 4 || !webgl2 ? 'low' : 'high';
}

function setFocus(id) {
  state.focus = id ? new Set([id, ...(state.neighbors.get(id) || [])]) : null;
  view.refresh();
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
    renderStatus();

    if (firstLoad) {
      loaderStatus(t('loadingGraph', data.nodes.length));
      await nextFrame(); // deja pintar el texto antes de calcular / let the text paint before computing
    }
    applyFilters();
    inspector.sync();
    if (!firstLoad && fired.length) view.fire(fired);
    if (firstLoad) finishLoading();
    firstLoad = false;
  } catch (err) {
    if (firstLoad) loaderStatus(t('loadingError'), true);
    else toast(`${t('error')}: ${err.message}`, true);
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
        node.z = (parent.z || 0) + (Math.random() - 0.5) * 30;
      }
    }
    next.set(raw.id, node);
  }
  state.nodes = next;

  // Cada nodo pertenece al "barrio" de su servicio o carpeta principal, para agruparlos en el espacio.
  // Every node belongs to the "neighbourhood" of its service or top folder, to group them in space.
  for (const node of next.values()) node.cluster = clusterOf(node);
  return fired;
}

function clusterOf(node) {
  let current = node;
  while (current) {
    const parent = state.nodes.get(current.parent);
    if (!parent) return null;
    if (parent.kind === 'root' || parent.kind === 'game') return current.id;
    current = parent;
  }
  return null;
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

const isRecent = (n) => n.changedAt && Date.now() - n.changedAt < RECENT_MS;

// ¿Se ve esta función? Sí si están activadas todas, si su módulo está abierto o si la buscas.
// Is this function visible? Yes if all are enabled, if its module is open or if you search for it.
function functionVisible(fn) {
  if (!state.hiddenKinds.has('function')) return true;
  const selected = state.nodes.get(state.selectedId);
  if (selected && (selected.id === fn.parent || (selected.kind === 'function' && selected.parent === fn.parent))) return true;
  return Boolean(state.matches && state.matches.has(fn.id));
}

function applyFilters() {
  let base = [...state.nodes.values()].filter((n) => !state.hiddenSources.has(n.source)
    && (n.kind === 'function' ? functionVisible(n) : !state.hiddenKinds.has(n.kind)));

  if (state.onlyRecent) {
    // Lo reciente y lo que tiene alrededor, para no verlo flotando solo.
    // Recent nodes plus their surroundings, so they don't float alone.
    const keep = new Set();
    for (const n of base) {
      if (!isRecent(n)) continue;
      keep.add(n.id);
      (state.neighbors.get(n.id) || []).forEach((id) => keep.add(id));
    }
    base = base.filter((n) => keep.has(n.id));
  }

  // Cientos de modelos parecidos (casas, árboles...) se juntan en un nodo "× N" que se despliega al pulsarlo.
  // Hundreds of similar models (houses, trees...) merge into one "× N" node that expands on click.
  const hasChildren = new Set();
  for (const n of state.nodes.values()) if (n.parent) hasChildren.add(n.parent);
  const byParent = new Map();
  for (const n of base) {
    if (!GROUPABLE.has(n.kind) || hasChildren.has(n.id) || !n.parent || state.expanded.has(n.parent)) continue;
    if (state.matches && state.matches.has(n.id)) continue;
    if (!byParent.has(n.parent)) byParent.set(n.parent, []);
    byParent.get(n.parent).push(n);
  }

  const representative = new Map(); // id oculto → id visible que lo representa / hidden id → visible id standing for it
  const groups = [];
  for (const [parentId, members] of byParent) {
    if (members.length < GROUP_MIN) continue;
    const id = `group:${parentId}`;
    const group = state.groups.get(id) || { id, kind: 'group', source: members[0].source };
    const names = new Set(members.map((m) => m.name.replace(/[_\s-]*\d+$/, '')));
    Object.assign(group, {
      parent: parentId,
      count: members.length,
      name: t('groupName', members.length, names.size === 1 ? [...names][0] : kindLabel(members[0].kind)),
      members: members.map((m) => m.id),
      cluster: members[0].cluster,
    });
    state.groups.set(id, group);
    groups.push(group);
    for (const m of members) representative.set(m.id, id);
  }

  const visible = [...base.filter((n) => !representative.has(n.id)), ...groups];
  const ids = new Set(visible.map((n) => n.id));
  const resolve = (id) => {
    if (ids.has(id)) return id;
    if (representative.has(id)) return representative.get(id);
    const node = state.nodes.get(id);
    return node && node.kind === 'function' && ids.has(node.parent) ? node.parent : null;
  };

  // Enlaces hacia lo oculto pasan a su representante (función → módulo, modelo → grupo).
  // Links to hidden nodes move to their representative (function → module, model → group).
  const seen = new Set();
  const links = [];
  for (const l of state.links) {
    if (state.hiddenLinks.has(l.type)) continue;
    const source = resolve(l.source);
    const target = resolve(l.target);
    if (!source || !target || source === target) continue;
    const key = `${source}|${target}|${l.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source, target, type: l.type });
  }

  view.render(visible, links);
  $('stats').textContent = `${visible.length} ${t('nodes')} · ${links.length} ${t('linksCount')}`;
}

function expandGroup(group) {
  state.expanded.add(group.parent);
  applyFilters();
  toast(t('expanded', group.count));
}

function regroup(parentId) {
  state.expanded.delete(parentId);
  applyFilters();
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

// Búsqueda dentro del código: pregunta al servidor y lista archivo:línea.
// Code search: asks the server and lists file:line.
let codeTimer;
let codeRequest = 0;
async function searchCode() {
  const q = state.query;
  const box = $('code-results');
  if (!q) {
    state.matches = null;
    box.replaceChildren();
    $('search-hint').textContent = '';
    applyFilters();
    return;
  }
  const ticket = ++codeRequest;
  const data = await api(`/api/search?q=${encodeURIComponent(q)}&limit=200`).catch(() => null);
  if (!data || ticket !== codeRequest) return; // llegó una búsqueda más nueva / a newer search arrived

  state.matches = new Set(data.results.map((r) => r.id));
  $('search-hint').textContent = data.total ? t('codeMatches', data.results.length, data.total) : t('noResults');
  box.replaceChildren(...data.results.map((r) => {
    const node = state.nodes.get(r.id);
    return h('button', { class: 'code-hit', type: 'button', onclick: () => select(r.id, { line: r.line }) },
      h('span', { class: 'where' }, node ? icon(node.kind, colorOfKind(node.kind)) : null, `${r.name}:${r.line}`),
      h('span', { class: 'snippet' }, highlightMatch(r.text, q)));
  }));
  applyFilters();
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

let namesTimer;
$('search').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  if (state.searchMode === 'code') {
    clearTimeout(codeTimer);
    codeTimer = setTimeout(searchCode, 250);
  } else {
    computeMatches();
    view.refresh();
    // Las funciones y modelos agrupados que coinciden aparecen al dejar de escribir.
    // Matching functions and grouped models appear once you stop typing.
    clearTimeout(namesTimer);
    namesTimer = setTimeout(applyFilters, 300);
  }
});

$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && state.searchMode === 'names' && state.matches && state.matches.size) {
    clearTimeout(namesTimer);
    applyFilters();
    // Primero el nombre exacto, luego el que empieza igual / Exact name first, then prefix
    const visible = new Set(view.visibleNodes().map((n) => n.id));
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

function filterButton({ label, count, color, off, kind, shape = 'dot', onClick }) {
  return h('button', { class: `filter${off ? ' off' : ''}`, type: 'button', onclick: onClick, 'aria-pressed': String(!off) },
    kind ? icon(kind, color) : h('span', { class: shape, style: `color:${color}` }),
    h('span', { class: 'label', text: label }),
    h('span', { class: 'count', text: count }));
}

function nodeButton(node, sub, onClick = () => select(node.id)) {
  return h('button', { class: 'link-item', type: 'button', onclick: onClick },
    icon(node.kind, colorOfKind(node.kind)),
    h('span', { class: 'name', text: node.name }),
    sub ? h('span', { class: 'sub', text: sub }) : null);
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
    kind: source === 'disk' ? 'folder' : 'game',
    off: state.hiddenSources.has(source),
    onClick: () => toggleIn(state.hiddenSources, source),
  })));

  $('kind-filters').replaceChildren(...KIND_ORDER.filter((k) => byKind.has(k)).map((kind) => filterButton({
    label: kindLabel(kind),
    count: byKind.get(kind),
    color: colorOfKind(kind),
    kind,
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

  renderToolbar();
  renderRecent();
  renderHealth();
}

function renderRecent() {
  const recent = [...state.nodes.values()].filter((n) => n.changedAt).sort((a, b) => b.changedAt - a.changedAt).slice(0, 8);
  $('recent-list').replaceChildren(...(recent.length
    ? recent.map((n) => nodeButton(n, t('ago', Math.floor((Date.now() - n.changedAt) / 60000))))
    : [h('p', { class: 'hint', text: t('nothingRecent') })]));
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
      const node = state.nodes.get(issue.ids[0]);
      const names = issue.ids.map((id) => state.nodes.get(id)?.name || id).join(type === 'cycle' ? ' → ' : ', ');
      return node ? nodeButton({ ...node, name: names }, issue.detail, () => select(node.id)) : null;
    }))));
}

$('only-recent').addEventListener('click', () => {
  state.onlyRecent = !state.onlyRecent;
  renderRecent();
  applyFilters();
});

// Los "hace X min" se ponen al día solos / The "X min ago" texts keep themselves up to date
setInterval(renderRecent, 30_000);

// ---------- Barra de vista (abajo) / View toolbar (bottom) ----------

function renderToolbar() {
  for (const b of document.querySelectorAll('#label-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === state.labels));
  for (const b of document.querySelectorAll('#quality-mode button')) b.setAttribute('aria-pressed', String(b.dataset.mode === view.quality));
}

for (const b of document.querySelectorAll('#label-mode button')) {
  b.addEventListener('click', () => {
    state.labels = b.dataset.mode;
    saveSetting('labels', state.labels);
    renderToolbar();
    view.refresh();
  });
}

for (const b of document.querySelectorAll('#quality-mode button')) {
  b.addEventListener('click', () => {
    saveSetting('quality', b.dataset.mode);
    view.setQuality(b.dataset.mode);
    renderToolbar();
  });
}

$('reset-btn').addEventListener('click', () => view.fit());

$('sidebar-toggle').addEventListener('click', () => {
  const hidden = document.body.classList.toggle('sidebar-hidden');
  $('sidebar-toggle').setAttribute('aria-expanded', String(!hidden));
});

// ---------- Estado de la conexión / Connection status ----------

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
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
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

// ---------- Selección / Selection ----------

function select(id, { line } = {}) {
  const node = state.nodes.get(id);
  if (!node) return;
  if (id === state.selectedId) {
    if (line) inspector.goToLine(line);
    view.flyTo(node);
    return;
  }
  if (!inspector.confirmDiscard()) return;
  const before = state.nodes.get(state.selectedId);
  state.selectedId = id;
  // Abrir un módulo enseña sus funciones (y cerrarlo las esconde) / Opening a module shows its functions (closing hides them)
  const reshaped = touchesFunctions(node) || touchesFunctions(before);
  if (reshaped) applyFilters();
  setFocus(id);
  view.flyTo(node);
  // Si aparecieron funciones, el grafo se recoloca un poco: volvemos a enfocar cuando se asiente.
  // If functions appeared, the graph shifts a little: refocus once it settles.
  if (reshaped) setTimeout(() => state.selectedId === id && view.flyTo(node), 900);
  inspector.open(node, { line });
}

function touchesFunctions(node) {
  return Boolean(node && (node.kind === 'function' || (node.symbols && node.symbols.length)));
}

// ---------- Teclado / Keyboard ----------

addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.closest('.cm-editor');
  if (typing) return;
  if (e.key === '/') {
    e.preventDefault();
    $('search').focus();
  } else if (e.key === 'Escape' && state.selectedId) {
    const before = state.nodes.get(state.selectedId);
    inspector.close();
    if (!state.selectedId && touchesFunctions(before)) applyFilters();
  } else if (e.key === '[') {
    $('sidebar-toggle').click();
  }
});

addEventListener('beforeunload', (e) => {
  if ((state.editor && state.editor.dirty) || (state.props && state.props.dirty)) e.preventDefault();
});

// ---------- Pantalla de carga / Loading screen ----------

function loaderStatus(text, bad = false) {
  const loader = $('loader');
  if (!loader) return;
  $('loader-status').textContent = text;
  loader.classList.toggle('error', bad);
}

async function finishLoading() {
  const wait = MIN_LOADER_MS - (performance.now() - startedAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  $('loader').classList.add('done');
  setTimeout(() => $('loader')?.remove(), 800);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

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
    if (firstLoad) loaderStatus(t('loadingError'), true);
  };
}

// En pantallas estrechas el grafo manda: filtros escondidos al empezar.
// On narrow screens the graph comes first: filters start hidden.
if (innerWidth < 700) $('sidebar-toggle').click();

renderStaticTexts();
renderStatus();
loaderStatus(t('loadingConnect'));
connectEvents();
