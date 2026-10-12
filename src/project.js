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
    this.version++;
    this.emit('graph', this.version);
    this.scheduleWrite();
    return this.graph;
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
