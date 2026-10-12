'use strict';
// Puente con Roblox Studio.
// Roblox Studio bridge.
//
// El plugin de Studio (roblox/SoulGraph.plugin.lua) envía aquí el árbol del juego
// y el código de cada script, y recoge las órdenes del panel (editar, abrir, renombrar).
// Todo se guarda en .soulgraph/studio.json para que el mapa siga ahí con Studio cerrado.
//
// The Studio plugin (roblox/SoulGraph.plugin.lua) sends the game tree and every
// script's source here, and picks up the panel's commands (edit, open, rename).
// Everything is saved to .soulgraph/studio.json so the map survives Studio being closed.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { kindOfInstance } = require('./kinds');
const { analyze } = require('./analyzers');
const { countLines } = require('./scanners/disk');

// Si el plugin no da señales en este tiempo, Studio se considera desconectado.
// If the plugin is silent for this long, Studio counts as disconnected.
const CONNECTED_WINDOW_MS = 25_000;
// Cuánto espera una petición de órdenes antes de responder vacía (long polling).
// How long a command poll waits before answering empty (long polling).
const POLL_HOLD_MS = 15_000;

const SCRIPT_KINDS = new Set(['server', 'client', 'module']);

class StudioBridge extends EventEmitter {
  constructor(storeFile) {
    super();
    this.storeFile = storeFile;
    this.place = null;
    this.lastSeen = 0;
    this.nodes = new Map(); // id → nodo / node
    this.sources = new Map(); // id → código / source
    this.queue = []; // órdenes pendientes / pending commands
    this.waiters = []; // peticiones de poll en espera / waiting poll requests
    this.saveTimer = null;
  }

  static idOf(rawId) {
    return `studio:${rawId}`;
  }

  get connected() {
    return Date.now() - this.lastSeen < CONNECTED_WINDOW_MS;
  }

  status() {
    return { place: this.place, connected: this.connected, lastSeen: this.lastSeen || null };
  }

  touch() {
    const wasConnected = this.connected;
    this.lastSeen = Date.now();
    if (!wasConnected) this.emit('change');
  }

  // ---------- Datos que llegan del plugin / Data coming from the plugin ----------

  // Reemplaza el árbol entero. Devuelve los ids de scripts cuyo código aún no tenemos.
  // Replaces the whole tree. Returns the ids of scripts whose source we don't have yet.
  setTree(place, list) {
    if (!Array.isArray(list)) throw new Error('nodes must be an array');

    const next = new Map();
    for (const raw of list) {
      if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.class !== 'string') continue;
      const node = {
        id: StudioBridge.idOf(raw.id),
        rawId: raw.id,
        source: 'studio',
        name: raw.name,
        class: raw.class,
        parent: typeof raw.parent === 'string' ? StudioBridge.idOf(raw.parent) : null,
        path: typeof raw.path === 'string' ? raw.path : raw.name,
        children: Number(raw.children) || 0,
        runContext: raw.runContext || undefined,
        disabled: raw.disabled === true || undefined,
        attrs: raw.attrs && typeof raw.attrs === 'object' ? raw.attrs : undefined,
        tags: Array.isArray(raw.tags) && raw.tags.length ? raw.tags : undefined,
      };
      node.kind = kindOfInstance({ ...raw, parent: node.parent });
      next.set(node.id, node);
    }

    // Conserva el análisis de los scripts que siguen existiendo.
    // Keep the analysis of scripts that still exist.
    for (const [id, node] of next) {
      const old = this.nodes.get(id);
      if (old && this.sources.has(id)) copyAnalysis(old, node);
    }
    for (const id of this.sources.keys()) {
      if (!next.has(id)) this.sources.delete(id);
    }

    this.place = typeof place === 'string' ? place : this.place;
    this.nodes = next;
    this.touch();
    this.changed();

    return [...next.values()]
      .filter((n) => SCRIPT_KINDS.has(n.kind) && !this.sources.has(n.id))
      .map((n) => n.rawId);
  }

  // Guarda el código de uno o varios scripts / Stores the source of one or more scripts
  setSources(items) {
    if (!Array.isArray(items)) throw new Error('items must be an array');
    let any = false;
    for (const item of items) {
      if (!item || typeof item.id !== 'string' || typeof item.source !== 'string') continue;
      if (this.setSource(StudioBridge.idOf(item.id), item.source)) any = true;
    }
    this.touch();
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
    Object.assign(node, analyze(source, { source: 'studio', lang: 'lua', path: node.path }));
    return true;
  }

  // ---------- Órdenes para el plugin / Commands for the plugin ----------

  enqueue(command) {
    this.queue.push(command);
    const waiter = this.waiters.shift();
    if (waiter) this.answerPoll(waiter);
  }

  // Long polling: responde en cuanto haya órdenes o tras POLL_HOLD_MS.
  // Long polling: answers as soon as there are commands, or after POLL_HOLD_MS.
  poll(res) {
    this.touch();
    const waiter = { res, timer: null };
    if (this.queue.length) return this.answerPoll(waiter);

    waiter.timer = setTimeout(() => this.answerPoll(waiter), POLL_HOLD_MS);
    res.on('close', () => {
      clearTimeout(waiter.timer);
      this.waiters = this.waiters.filter((w) => w !== waiter);
    });
    this.waiters.push(waiter);
  }

  answerPoll(waiter) {
    clearTimeout(waiter.timer);
    this.waiters = this.waiters.filter((w) => w !== waiter);
    const commands = this.queue.splice(0);
    if (waiter.res.writableEnded) {
      // El plugin se fue: devolvemos las órdenes a la cola / Plugin left: put commands back
      this.queue.unshift(...commands);
      return;
    }
    waiter.res.writeHead(200, { 'Content-Type': 'application/json' });
    waiter.res.end(JSON.stringify(commands));
  }

  // ---------- Espejo y persistencia / Mirror and persistence ----------

  // Ruta de cada script dentro de .soulgraph/studio/ (estilo Rojo: .server.lua, .client.lua, .lua).
  // Path of every script inside .soulgraph/studio/ (Rojo style: .server.lua, .client.lua, .lua).
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
      this.place = data.place || null;
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
      place: this.place,
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

function copyAnalysis(from, to) {
  for (const key of ['lines', 'rev', 'editable', 'symbols', 'imports', 'refs']) {
    if (from[key] !== undefined) to[key] = from[key];
  }
}

// Nombres válidos en Windows, macOS y Linux / Names valid on Windows, macOS and Linux
function safeFileName(name) {
  let clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
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
