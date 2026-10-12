'use strict';
// Construye el grafo final: nodos de disco + nodos de Studio + enlaces entre ellos.
// Builds the final graph: disk nodes + Studio nodes + the links between them.
//
// Tipos de enlace / Link types:
//   contains   carpeta → archivo, padre → hijo / folder → file, parent → child
//   requires   script → módulo que usa / script → module it uses
//   references archivo → archivo que nombra (obj → mtl → png) / file → file it names

function buildGraph(diskNodes, studioNodes) {
  const nodes = [...diskNodes, ...studioNodes];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = [];
  const seen = new Set();

  const link = (source, target, type) => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    const key = `${source}|${target}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, type });
  };

  // Índices por nombre para resolver imports y referencias.
  // Name indexes to resolve imports and references.
  const modulesByName = new Map(); // "Ciclo" → [ids]
  const filesByName = new Map(); // "karakura.mtl" → [ids]
  const add = (map, key, id) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(id);
  };

  for (const n of nodes) {
    if (n.source === 'studio' && n.kind === 'module') add(modulesByName, n.name, n.id);
    if (n.source === 'disk' && n.kind !== 'folder' && n.kind !== 'root') {
      add(filesByName, n.name.toLowerCase(), n.id);
      // En disco un módulo se llama como su archivo (Foo.lua) o su carpeta (Foo/init.lua).
      // On disk a module is named after its file (Foo.lua) or its folder (Foo/init.lua).
      if (n.kind === 'code') {
        const base = n.name.replace(/(\.server|\.client)?\.[^.]+$/, '');
        const moduleName = base === 'init' ? n.path.split('/').slice(-2, -1)[0] : base;
        if (moduleName) add(modulesByName, moduleName, n.id);
      }
    }
  }

  for (const n of nodes) {
    if (n.parent) link(n.parent, n.id, 'contains');
    for (const name of n.imports || []) {
      for (const target of modulesByName.get(name) || []) link(n.id, target, 'requires');
    }
    for (const name of n.refs || []) {
      for (const target of filesByName.get(name) || []) link(n.id, target, 'references');
    }
  }

  return { nodes, links };
}

// Quién usa a quién (al revés de `requires`) / Who uses whom (the reverse of `requires`)
function usedByIndex(graph) {
  const index = new Map();
  for (const l of graph.links) {
    if (l.type !== 'requires') continue;
    if (!index.has(l.target)) index.set(l.target, []);
    index.get(l.target).push(l.source);
  }
  return index;
}

module.exports = { buildGraph, usedByIndex };
