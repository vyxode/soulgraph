'use strict';
// Un proyecto vigilado: une el escáner de disco, el puente de Studio y el grafo.
// A watched project: ties together the disk scanner, the Studio bridge and the graph.
//
// Emite 'graph' cada vez que el grafo cambia (lo usa el panel para refrescarse en vivo).
// Emits 'graph' whenever the graph changes (the panel uses it to refresh live).

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { DiskScanner } = require('./scanners/disk');
const { StudioBridge } = require('./studio');
const { buildGraph } = require('./graph');
const { writeOutputs } = require('./map-writer');

const REBUILD_DELAY_MS = 250; // agrupa ráfagas de cambios / batches bursts of changes
const WRITE_DELAY_MS = 1000; // MAP.md no necesita escribirse en cada tecla / no need to write MAP.md on every keystroke
const BULK_LOAD = 200; // más nodos nuevos de golpe = carga inicial / more new nodes at once = initial load

class Project extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.name = path.basename(config.root);
    this.outDir = path.join(config.root, '.soulgraph');
    this.disk = new DiskScanner(config);
    this.studio = new StudioBridge(path.join(this.outDir, 'studio.json'));
    this.studio.load();

    this.diskNodes = [];
    this.diskDirty = true;
    this.graph = { nodes: [], links: [] };
    this.byId = new Map();
    this.signatures = null;
    this.changedAt = new Map();
    this.version = 0;
    this.rebuildTimer = null;
    this.writeTimer = null;

    this.studio.on('change', () => this.scheduleRebuild());
  }

  rebuild() {
    clearTimeout(this.rebuildTimer);
    if (this.diskDirty) {
      this.diskNodes = this.disk.scan();
      this.diskDirty = false;
    }
    this.graph = buildGraph(this.diskNodes, [...this.studio.nodes.values()]);
    this.byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    this.markChanges();
    this.version++;
    this.emit('graph', this.version);
    this.scheduleWrite();
    return this.graph;
  }

  // Apunta cuándo cambió cada nodo, para que el panel lo haga "disparar" y filtre lo reciente.
  // Records when each node changed, so the panel can make it "fire" and filter recent ones.
  markChanges() {
    const now = Date.now();
    const firstBuild = !this.signatures;
    const next = new Map();
    const fresh = [];
    for (const n of this.graph.nodes) {
      const signature = n.rev ?? JSON.stringify([n.name, n.parent, n.attrs, n.tags, n.children, n.disabled]);
      const before = firstBuild ? signature : this.signatures.get(n.id);
      if (before === undefined) fresh.push(n);
      else if (before !== signature) n.changedAt = now;
      else if (this.changedAt.has(n.id)) n.changedAt = this.changedAt.get(n.id);
      next.set(n.id, signature);
    }
    // Un lugar que se conecta (o reconecta con ids nuevos) no es "actividad": solo cuentan
    // los nodos nuevos sueltos. Se mira por ámbito: el disco y cada ventana de Studio.
    // A place connecting (or reconnecting with new ids) isn't "activity": only scattered
    // new nodes count. Checked per scope: the disk and each Studio window.
    const scopeOf = (n) => n.session || n.source;
    const total = new Map();
    const added = new Map();
    for (const n of this.graph.nodes) total.set(scopeOf(n), (total.get(scopeOf(n)) || 0) + 1);
    for (const n of fresh) added.set(scopeOf(n), (added.get(scopeOf(n)) || 0) + 1);
    for (const n of fresh) {
      const count = added.get(scopeOf(n));
      if (count <= BULK_LOAD && count <= Math.max(20, total.get(scopeOf(n)) * 0.3)) n.changedAt = now;
    }
    this.signatures = next;
    this.changedAt = new Map(this.graph.nodes.filter((n) => n.changedAt).map((n) => [n.id, n.changedAt]));
  }

  scheduleRebuild({ disk = false } = {}) {
    if (disk) this.diskDirty = true;
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(), REBUILD_DELAY_MS);
  }

  scheduleWrite() {
    clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.write(), WRITE_DELAY_MS);
  }

  write() {
    clearTimeout(this.writeTimer);
    try {
      writeOutputs({ outDir: this.outDir, project: this.name, graph: this.graph, studio: this.studio });
    } catch (err) {
      console.error(`[soulgraph] no se pudo escribir .soulgraph / could not write .soulgraph: ${err.message}`);
    }
  }

  // Vigila la carpeta del proyecto y reconstruye al cambiar algo.
  // Watches the project folder and rebuilds when something changes.
  watch() {
    const ignore = new Set(this.config.ignore);
    try {
      this.watcher = fs.watch(this.config.root, { recursive: true }, (_event, file) => {
        // Ignora lo que escribimos nosotros mismos (.soulgraph) para no entrar en bucle.
        // Ignore what we write ourselves (.soulgraph) so we don't loop forever.
        if (file && String(file).split(/[\\/]/).some((part) => ignore.has(part))) return;
        this.scheduleRebuild({ disk: true });
      });
      this.watcher.on('error', (err) => console.warn(`[soulgraph] watcher: ${err.message}`));
    } catch (err) {
      console.warn(`[soulgraph] no se puede vigilar la carpeta / can't watch the folder: ${err.message}`);
    }
  }

  close() {
    if (this.watcher) this.watcher.close();
    clearTimeout(this.rebuildTimer);
    this.write();
    this.studio.save();
  }
}

module.exports = { Project };
