'use strict';
// Construye el grafo final: nodos de disco + nodos de Studio + funciones + enlaces + avisos de salud.
// Builds the final graph: disk nodes + Studio nodes + functions + links + health issues.
//
// Tipos de enlace / Link types:
//   contains   carpeta → archivo, padre → hijo / folder → file, parent → child
//   requires   script → módulo que usa / script → module it uses
//   calls      script → función de otro módulo que llama / script → another module's function it calls
//   signal     quien dispara → evento → quien escucha / sender → event → listener
//   references archivo → archivo que nombra (obj → mtl → png) / file → file it names
//
// Los nombres se resuelven dentro de su "ámbito": el disco, o cada ventana de Studio por separado,
// para que dos lugares abiertos a la vez no se mezclen.
// Names are resolved within their "scope": the disk, or each Studio window separately,
// so two places open at once don't get mixed up.

function buildGraph(diskNodes, studioNodes) {
  const base = [...diskNodes, ...studioNodes];
  const nodes = [...base];
  const byId = new Map(base.map((n) => [n.id, n]));
  const links = [];
  const seen = new Set();
  const issues = [];

  const link = (source, target, type) => {
    if (source === target || !byId.has(source) || !byId.has(target)) return;
    const key = `${source}|${target}|${type}`;
    if (seen.has(key)) return;
    seen.add(key);
    links.push({ source, target, type });
  };

  // ---------- Índices por nombre / Name indexes ----------

  const scopeOf = (n) => (n.source === 'studio' ? `studio:${n.session}` : 'disk');
  const modules = new Map(); // ámbito / scope → nombre / name → [ids]
  const events = new Map(); // ámbito / scope → nombre / name → [ids]
  const files = new Map(); // "karakura.mtl" → [ids]
  const push = (map, key, id) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(id);
  };
  const inScope = (index, n) => {
    const scope = scopeOf(n);
    if (!index.has(scope)) index.set(scope, new Map());
    return index.get(scope);
  };

  for (const n of base) {
    const name = moduleName(n);
    if (name) push(inScope(modules, n), name, n.id);
    if (n.kind === 'remote') push(inScope(events, n), n.name, n.id);
    if (n.source === 'disk' && n.kind !== 'folder' && n.kind !== 'root') push(files, n.name.toLowerCase(), n.id);
  }

  // ---------- Nodos de función / Function nodes ----------
  // Solo las funciones públicas de un módulo (M.algo, M:algo): son las que otros pueden llamar.
  // Only a module's public functions (M.thing, M:thing): the ones others can call.

  const functionsOf = new Map(); // id del módulo / module id → nombre corto / short name → [ids]
  for (const n of base) {
    if (!moduleName(n) || !n.symbols) continue;
    for (const symbol of n.symbols) {
      if (!/[.:]/.test(symbol)) continue;
      const fn = {
        id: `${n.id}#${symbol}`,
        source: n.source,
        session: n.session,
        kind: 'function',
        name: symbol,
        parent: n.id,
      };
      nodes.push(fn);
      byId.set(fn.id, fn);
      if (!functionsOf.has(n.id)) functionsOf.set(n.id, new Map());
      push(functionsOf.get(n.id), symbol.split(/[.:]/).pop(), fn.id);
    }
  }

  // ---------- Enlaces / Links ----------

  for (const n of nodes) {
    if (n.parent) link(n.parent, n.id, 'contains');
    const scopeModules = modules.get(scopeOf(n)) || new Map();
    const scopeEvents = events.get(scopeOf(n)) || new Map();

    for (const name of n.imports || []) {
      const targets = scopeModules.get(name);
      if (!targets) issues.push({ type: 'broken-require', ids: [n.id], detail: name });
      for (const target of targets || []) link(n.id, target, 'requires');
    }

    for (const call of n.calls || []) {
      const [moduleNameCalled, fn] = call.split('.');
      for (const moduleId of scopeModules.get(moduleNameCalled) || []) {
        for (const fnId of (functionsOf.get(moduleId) || new Map()).get(fn) || []) link(n.id, fnId, 'calls');
      }
    }

    for (const name of n.sends || []) {
      for (const eventId of scopeEvents.get(name) || []) link(n.id, eventId, 'signal');
    }
    for (const name of n.listens || []) {
      for (const eventId of scopeEvents.get(name) || []) link(eventId, n.id, 'signal');
    }

    for (const name of n.refs || []) {
      for (const target of files.get(name) || []) link(n.id, target, 'references');
    }
  }

  issues.push(...healthIssues(nodes, links, modules));
  return { nodes, links, issues };
}

// ---------- Salud del proyecto / Project health ----------

function healthIssues(nodes, links, modules) {
  const issues = [];
  const required = new Set(links.filter((l) => l.type === 'requires').map((l) => l.target));

  // Mismo nombre en el mismo lugar: require por nombre es ambiguo.
  // Same name in the same place: requiring by name is ambiguous.
  for (const byName of modules.values()) {
    for (const [name, ids] of byName) {
      if (ids.length > 1) issues.push({ type: 'duplicate-name', ids, detail: name });
    }
  }

  // Módulos que nadie requiere (puede que se carguen de forma dinámica).
  // Modules nobody requires (they might be loaded dynamically).
  for (const n of nodes) {
    if (moduleName(n) && !required.has(n.id)) issues.push({ type: 'unused-module', ids: [n.id] });
  }

  // Eventos que se disparan pero nadie escucha, o al revés.
  // Events fired but never listened to, or the other way round.
  for (const n of nodes) {
    if (n.kind !== 'remote') continue;
    const incoming = links.some((l) => l.type === 'signal' && l.target === n.id);
    const outgoing = links.some((l) => l.type === 'signal' && l.source === n.id);
    if (incoming && !outgoing) issues.push({ type: 'event-no-listener', ids: [n.id] });
    if (!incoming && outgoing) issues.push({ type: 'event-no-sender', ids: [n.id] });
  }

  for (const cycle of requireCycles(links)) issues.push({ type: 'cycle', ids: cycle });
  return issues;
}

// Dependencias circulares con el algoritmo de Tarjan (componentes fuertemente conexos).
// Circular dependencies with Tarjan's algorithm (strongly connected components).
function requireCycles(links) {
  const edges = new Map();
  for (const l of links) {
    if (l.type !== 'requires') continue;
    if (!edges.has(l.source)) edges.set(l.source, []);
    edges.get(l.source).push(l.target);
  }

  const index = new Map();
  const low = new Map();
  const stack = [];
  const onStack = new Set();
  const cycles = [];
  let counter = 0;

  const visit = (v) => {
    index.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) || []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v), low.get(w)));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v), index.get(w)));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = [];
      let w;
      do {
        w = stack.pop();
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) cycles.push(component.reverse());
    }
  };

  for (const v of edges.keys()) if (!index.has(v)) visit(v);
  return cycles;
}

// Nombre con el que otros requieren este nodo, o null si no es un módulo.
// The name others require this node by, or null if it isn't a module.
function moduleName(n) {
  if (n.source === 'studio') return n.kind === 'module' ? n.name : null;
  if (n.kind !== 'code' || !['lua', 'luau'].includes(n.ext)) return null;
  // En disco: Foo.lua o Foo/init.lua (estilo Rojo) / On disk: Foo.lua or Foo/init.lua (Rojo style)
  const base = n.name.replace(/(\.server|\.client)?\.[^.]+$/, '');
  if (/\.(server|client)\.[^.]+$/.test(n.name)) return null; // scripts, no módulos / scripts, not modules
  return base === 'init' ? n.path.split('/').slice(-2, -1)[0] || null : base;
}

// Ruta legible de un nodo: "Mapa/karakura.obj", "Lugar/ReplicatedStorage/Ciclo", ".../Modulo#M.fn".
// Readable path of a node: "Mapa/karakura.obj", "Place/ReplicatedStorage/Ciclo", ".../Module#M.fn".
function pathOf(n, byId) {
  if (n.kind === 'function') return `${pathOf(byId.get(n.parent) || {}, byId)}#${n.name}`;
  if (n.source === 'disk') return n.path || n.name || '';
  const parts = [];
  for (let cur = n; cur; cur = byId.get(cur.parent)) parts.unshift(cur.name);
  return parts.join('/');
}

// Quién usa a quién (al revés de `requires` y `calls`) / Who uses whom (the reverse of `requires` and `calls`)
function usedByIndex(graph) {
  const index = new Map();
  for (const l of graph.links) {
    if (l.type !== 'requires' && l.type !== 'calls') continue;
    if (!index.has(l.target)) index.set(l.target, []);
    index.get(l.target).push(l.source);
  }
  return index;
}

module.exports = { buildGraph, usedByIndex, moduleName, pathOf };
