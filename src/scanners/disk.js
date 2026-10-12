'use strict';
// Escáner del disco: recorre la carpeta del proyecto y crea un nodo por carpeta y archivo.
// Disk scanner: walks the project folder and creates one node per folder and file.
//
// Guarda en caché el análisis de cada archivo (por tamaño + fecha), así que
// volver a escanear después de un cambio solo relee lo que cambió.
// It caches each file's analysis (by size + mtime), so rescanning after a
// change only re-reads what actually changed.

const fs = require('fs');
const path = require('path');
const { extOf, kindOfFile, isTextFile } = require('../kinds');
const { analyze } = require('../analyzers');

class DiskScanner {
  constructor(config) {
    this.config = config;
    this.ignore = new Set(config.ignore);
    this.cache = new Map(); // ruta relativa / relative path → { key, info }
  }

  // Id estable de un nodo de disco / Stable id of a disk node
  static idOf(relPath) {
    return `disk:${relPath}`;
  }

  scan() {
    const nodes = [];
    const seen = new Set();
    const rootName = path.basename(this.config.root);

    nodes.push({ id: DiskScanner.idOf(''), source: 'disk', kind: 'root', name: rootName, path: '' });
    this.walk('', nodes, seen);

    // Olvida de la caché lo que ya no existe / Drop cache entries that no longer exist
    for (const rel of this.cache.keys()) {
      if (!seen.has(rel)) this.cache.delete(rel);
    }
    return nodes;
  }

  walk(relDir, nodes, seen) {
    const absDir = path.join(this.config.root, relDir);
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return; // carpeta sin permisos o borrada a mitad / unreadable or deleted mid-scan
    }

    for (const entry of entries) {
      if (this.ignore.has(entry.name) || entry.isSymbolicLink()) continue;

      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const parent = DiskScanner.idOf(relDir);

      if (entry.isDirectory()) {
        nodes.push({ id: DiskScanner.idOf(rel), source: 'disk', kind: 'folder', name: entry.name, path: rel, parent });
        this.walk(rel, nodes, seen);
      } else if (entry.isFile()) {
        seen.add(rel);
        const info = this.fileInfo(rel);
        if (info) nodes.push({ id: DiskScanner.idOf(rel), parent, ...info });
      }
    }
  }

  fileInfo(rel) {
    const abs = path.join(this.config.root, rel);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      return null;
    }

    const key = `${stat.size}:${stat.mtimeMs}`;
    const cached = this.cache.get(rel);
    if (cached && cached.key === key) return cached.info;

    const name = path.basename(rel);
    const info = {
      source: 'disk',
      kind: kindOfFile(name),
      name,
      ext: extOf(name),
      path: rel,
      size: stat.size,
      rev: String(stat.mtimeMs),
    };

    if (isTextFile(name)) {
      const whole = stat.size <= this.config.maxTextBytes;
      const text = whole ? safeRead(abs) : readStart(abs, this.config.sampleBytes);
      if (text !== null) {
        if (whole) {
          info.lines = countLines(text);
          info.editable = true;
        }
        Object.assign(info, analyze(text, { source: 'disk', ext: info.ext, path: rel }));
      }
    }

    this.cache.set(rel, { key, info });
    return info;
  }

  // Convierte un id de nodo en ruta absoluta, sin dejar salir de la raíz del proyecto.
  // Turns a node id into an absolute path, never letting it escape the project root.
  resolve(id) {
    if (!id.startsWith('disk:')) return null;
    const rel = id.slice('disk:'.length);
    const abs = path.resolve(this.config.root, rel);
    const inside = abs === this.config.root || abs.startsWith(this.config.root + path.sep);
    if (!inside) return null;
    if (rel.split('/').some((part) => this.ignore.has(part))) return null;
    return abs;
  }
}

function safeRead(abs) {
  try {
    return fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
}

function readStart(abs, bytes) {
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const buffer = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buffer, 0, bytes, 0);
    return buffer.toString('utf8', 0, read);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function countLines(text) {
  if (!text) return 0;
  let lines = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lines++;
  return lines;
}

module.exports = { DiskScanner, countLines };
