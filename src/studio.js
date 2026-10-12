'use strict';
// Puente con Roblox Studio.
// Roblox Studio bridge.
//
// El plugin de Studio (roblox/SoulGraph.plugin.lua) envía aquí el árbol del juego
// y el código de cada script, y recoge las órdenes del panel (editar, abrir, renombrar).
// Cada ventana de Studio es una "sesión" con su propio lugar, así que pueden convivir varias.
// Todo se guarda en .soulgraph/studio.json para que el mapa siga ahí con Studio cerrado.
//
// The Studio plugin (roblox/SoulGraph.plugin.lua) sends the game tree and every
// script's source here, and picks up the panel's commands (edit, open, rename).
// Each Studio window is a "session" with its own place, so several can live side by side.
// Everything is saved to .soulgraph/studio.json so the map survives Studio being closed.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { kindOfInstance } = require('./kinds');
const { analyze } = require('./analyzers');
const { countLines } = require('./scanners/disk');

// Si el plugin no da señales en este tiempo, esa ventana se considera desconectada.
// If the plugin is silent for this long, that window counts as disconnected.
const CONNECTED_WINDOW_MS = 25_000;
// Cuánto espera una petición de órdenes antes de responder vacía (long polling).
// How long a command poll waits before answering empty (long polling).
const POLL_HOLD_MS = 15_000;

const SCRIPT_KINDS = new Set(['server', 'client', 'module']);

class StudioBridge extends EventEmitter {
  constructor(storeFile) {
    super();
    this.storeFile = storeFile;
    this.sessions = new Map(); // clave / key → { key, place, lastSeen, queue, waiters }
    this.nodes = new Map(); // id → nodo de cualquier sesión / node from any session
    this.sources = new Map(); // id → código / source
    this.saveTimer = null;
  }

  // La clave viene del plugin (PlaceId o nombre del lugar); la limpiamos para usarla en ids.
  // The key comes from the plugin (PlaceId or place name); we clean it for use in ids.
  static keyOf(raw) {
    return String(raw || 'default').replace(/[^\w-]/g, '_').slice(0, 64) || 'default';
  }

  static idOf(key, rawId) {
    return rawId === undefined ? `studio:${key}` : `studio:${key}:${rawId}`;
  }

  session(rawKey) {
    const key = StudioBridge.keyOf(rawKey);
    if (!this.sessions.has(key)) {
      this.sessions.set(key, { key, place: key, lastSeen: 0, queue: [], waiters: [] });
    }
    return this.sessions.get(key);
  }

  get connected() {
    return [...this.sessions.values()].some(isConnected);
  }

  status() {
    return {
      connected: this.connected,
      sessions: [...this.sessions.values()].map((s) => ({
        key: s.key,
        place: s.place,
        connected: isConnected(s),
        lastSeen: s.lastSeen || null,
      })),
    };
  }

  touch(rawKey) {
    const session = this.session(rawKey);
    const was = isConnected(session);
    session.lastSeen = Date.now();
    if (!was) this.emit('change');
    return session;
  }

  // ---------- Datos que llegan del plugin / Data coming from the plugin ----------

  // Reemplaza el árbol de una ventana. Devuelve los ids de scripts cuyo código aún no tenemos.
  // Replaces one window's tree. Returns the ids of scripts whose source we don't have yet.
  setTree(rawKey, place, list) {
    if (!Array.isArray(list)) throw new Error('nodes must be an array');
    const session = this.touch(rawKey);
    if (typeof place === 'string' && place) session.place = place;

    const { key } = session;
    const rootId = StudioBridge.idOf(key);
    const next = new Map();

    // El propio lugar es la raíz de su árbol / The place itself is the root of its tree
    next.set(rootId, { id: rootId, source: 'studio', session: key, kind: 'game', class: 'DataModel', name: session.place });

    for (const raw of list) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.class !== 'string') continue;
      const node = {
        id: StudioBridge.idOf(key, raw.id),
        rawId: raw.id,
        source: 'studio',
        session: key,
        name: raw.name,
        class: raw.class,
        parent: typeof raw.parent === 'string' ? StudioBridge.idOf(key, raw.parent) : rootId,
        children: Number(raw.children) || 0,
        runContext: raw.runContext || undefined,
        disabled: raw.disabled === true || undefined,
        attrs: raw.attrs && typeof raw.attrs === 'object' ? raw.attrs : undefined,
        tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
      };
      node.kind = kindOfInstance({ ...raw, parent: raw.parent });
      next.set(node.id, node);
    }

    // Quita lo que ya no existe en esta ventana y conserva el análisis de lo que sigue.
    // Drop what no longer exists in this window and keep the analysis of what remains.
    for (const [id, old] of this.nodes) {
      if (old.session !== key) continue;
      if (next.has(id) && this.sources.has(id)) copyAnalysis(old, next.get(id));
      if (!next.has(id)) {
        this.nodes.delete(id);
        this.sources.delete(id);
      }
    }
    for (const [id, node] of next) this.nodes.set(id, node);

    this.changed();
    return [...next.values()]
      .filter((n) => SCRIPT_KINDS.has(n.kind) && !this.sources.has(n.id))
      .map((n) => n.rawId);
  }

  // Guarda el código de uno o varios scripts / Stores the source of one or more scripts
  setSources(rawKey, items) {
    if (!Array.isArray(items)) throw new Error('items must be an array');
    const { key } = this.touch(rawKey);
    let any = false;
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || typeof item.source !== 'string') continue;
      if (this.setSource(StudioBridge.idOf(key, item.id), item.source)) any = true;
    }
    if (any) this.changed();
  }

  setSource(id, source) {
    const node = this.nodes.get(id);
    if (!node || !SCRIPT_KINDS.has(node.kind)) return false;
    if (this.sources.get(id) === source) return false;

    this.sources.set(id, source);
    node.lines = countLines(source);
    node.rev = hash(source);
    node.editable = true;
    for (const key of ANALYSIS_KEYS) delete node[key];
    Object.assign(node, analyze(source, { source: 'studio', lang: 'lua', path: node.name }));
    return true;
  }

  // ---------- Órdenes para el plugin / Commands for the plugin ----------

  isConnectedNode(node) {
    const session = this.sessions.get(node.session);
    return Boolean(session && isConnected(session));
  }

  enqueue(node, command) {
    const session = this.session(node.session);
    session.queue.push({ ...command, id: node.rawId });
    const waiter = session.waiters.shift();
    if (waiter) answerPoll(session, waiter);
  }

  // Long polling: responde en cuanto haya órdenes o tras POLL_HOLD_MS.
  // Long polling: answers as soon as there are commands, or after POLL_HOLD_MS.
  poll(rawKey, res) {
    const session = this.touch(rawKey);
    const waiter = { res, timer: null };
    if (session.queue.length) return answerPoll(session, waiter);

    waiter.timer = setTimeout(() => answerPoll(session, waiter), POLL_HOLD_MS);
    res.on('close', () => {
      clearTimeout(waiter.timer);
      session.waiters = session.waiters.filter((w) => w !== waiter);
    });
    session.waiters.push(waiter);
  }

  // ---------- Espejo y persistencia / Mirror and persistence ----------

  // Ruta de cada script dentro de .soulgraph/studio/<lugar>/ (estilo Rojo: .server.lua, .client.lua, .lua).
  // Path of every script inside .soulgraph/studio/<place>/ (Rojo style: .server.lua, .client.lua, .lua).
  mirrorPaths() {
    const result = new Map();
    const taken = new Set();

    for (const node of this.nodes.values()) {
      if (!SCRIPT_KINDS.has(node.kind) || !this.sources.has(node.id)) continue;

      const parts = [];
      for (let n = node; n; n = this.nodes.get(n.parent)) parts.unshift(safeFileName(n.name));
      const suffix = node.kind === 'server' ? '.server.lua' : node.kind === 'client' ? '.client.lua' : '.lua';

      let rel = parts.join('/') + suffix;
      for (let i = 2; taken.has(rel.toLowerCase()); i++) rel = `${parts.join('/')}~${i}${suffix}`;
      taken.add(rel.toLowerCase());
      result.set(node.id, rel);
    }
    return result;
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
      if (!Array.isArray(data.sessions)) return; // formato antiguo: se empieza de cero / old format: start fresh
      for (const s of data.sessions) this.sessions.set(s.key, { ...s, lastSeen: 0, queue: [], waiters: [] });
      for (const node of data.nodes || []) this.nodes.set(node.id, node);
      for (const [id, source] of Object.entries(data.sources || {})) this.sources.set(id, source);
    } catch {
      // Primera vez o archivo dañado: se empieza vacío / First run or damaged file: start empty
    }
  }

  changed() {
    this.emit('change');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  save() {
    clearTimeout(this.saveTimer);
    const data = {
      sessions: [...this.sessions.values()].map(({ key, place, lastSeen }) => ({ key, place, lastSeenBefore: lastSeen })),
      nodes: [...this.nodes.values()],
      sources: Object.fromEntries(this.sources),
    };
    fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
    // Escritura atómica: si se corta a mitad, el archivo anterior sigue intacto.
    // Atomic write: if it's interrupted, the previous file stays intact.
    const tmp = `${this.storeFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.storeFile);
  }
}

const ANALYSIS_KEYS = ['symbols', 'imports', 'refs', 'calls', 'sends', 'listens'];

function isConnected(session) {
  return Date.now() - session.lastSeen < CONNECTED_WINDOW_MS;
}

function answerPoll(session, waiter) {
  clearTimeout(waiter.timer);
  session.waiters = session.waiters.filter((w) => w !== waiter);
  const commands = session.queue.splice(0);
  if (waiter.res.writableEnded || waiter.res.destroyed) {
    // El plugin se fue: devolvemos las órdenes a la cola / Plugin left: put commands back
    session.queue.unshift(...commands);
    return;
  }
  waiter.res.writeHead(200, { 'Content-Type': 'application/json' });
  waiter.res.end(JSON.stringify(commands));
}

function copyAnalysis(from, to) {
  for (const key of ['lines', 'rev', 'editable', ...ANALYSIS_KEYS]) {
    if (from[key] !== undefined) to[key] = from[key];
  }
}

// Nombres válidos en Windows, macOS y Linux / Names valid on Windows, macOS and Linux
function safeFileName(name) {
  let clean = String(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!clean) clean = '_';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) clean = `_${clean}`;
  return clean;
}

// FNV-1a: huella rápida para detectar cambios, no es criptográfica.
// FNV-1a: fast fingerprint to detect changes, not cryptographic.
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

module.exports = { StudioBridge, safeFileName, hash, SCRIPT_KINDS };
