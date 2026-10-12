'use strict';
// Pruebas de extremo a extremo: proyecto en una carpeta temporal + servidor real.
// End-to-end tests: a project in a temp folder + the real server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { loadConfig } = require('../src/config');
const { Project } = require('../src/project');
const { createServer } = require('../src/server');

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soulgraph-'));
  fs.mkdirSync(path.join(root, 'Mapa'));
  fs.writeFileSync(path.join(root, 'Mapa', 'city.obj'), 'mtllib city.mtl\n');
  fs.writeFileSync(path.join(root, 'Mapa', 'city.mtl'), 'map_Kd wall.png\n');
  fs.writeFileSync(path.join(root, 'Mapa', 'wall.png'), 'not really a png');
  fs.writeFileSync(path.join(root, 'notes.md'), '# hi\n');
  fs.writeFileSync(path.join(root, 'outside-secret.txt'), 'secret');
  const config = loadConfig(root);
  config.port = 7900 + Math.floor(Math.random() * 90);
  return { root, config };
}

test('builds disk graph with reference links and writes MAP.md', () => {
  const { root, config } = makeProject();
  const project = new Project(config);
  project.rebuild();
  project.close();

  const refs = project.graph.links.filter((l) => l.type === 'references').map((l) => `${l.source}>${l.target}`);
  assert.ok(refs.includes('disk:Mapa/city.obj>disk:Mapa/city.mtl'));
  assert.ok(refs.includes('disk:Mapa/city.mtl>disk:Mapa/wall.png'));
  assert.ok(fs.readFileSync(path.join(root, '.soulgraph', 'MAP.md'), 'utf8').includes('city.obj'));
});

test('studio bridge: tree, sources, require links and mirror files', () => {
  const { root, config } = makeProject();
  const project = new Project(config);
  const need = project.studio.setTree('123', 'Test Place', [
    { id: 'rs', name: 'ReplicatedStorage', class: 'ReplicatedStorage' },
    { id: 'mod', name: 'Ciclo', class: 'ModuleScript', parent: 'rs' },
    { id: 'sss', name: 'ServerScriptService', class: 'ServerScriptService' },
    { id: 'main', name: 'Main', class: 'Script', parent: 'sss' },
  ]);
  assert.deepEqual(need.sort(), ['main', 'mod']);

  project.studio.setSources('123', [
    { id: 'mod', source: 'local M = {}\nfunction M.go() end\nreturn M' },
    { id: 'main', source: 'local Ciclo = require(game.ReplicatedStorage.Ciclo)\nCiclo.go()' },
  ]);
  project.rebuild();
  project.close();

  assert.ok(project.graph.links.some((l) => l.type === 'requires' && l.source === 'studio:123:main' && l.target === 'studio:123:mod'));
  // La llamada a Ciclo.go() enlaza con el nodo de la función / The Ciclo.go() call links to the function node
  assert.ok(project.graph.links.some((l) => l.type === 'calls' && l.source === 'studio:123:main' && l.target === 'studio:123:mod#M.go'));
  const mirror = path.join(root, '.soulgraph', 'studio', 'Test Place', 'ServerScriptService', 'Main.server.lua');
  assert.equal(fs.readFileSync(mirror, 'utf8'), 'local Ciclo = require(game.ReplicatedStorage.Ciclo)\nCiclo.go()');
});

test('graph: remote events, health issues and separate Studio windows', () => {
  const { buildGraph } = require('../src/graph');
  const node = (session, id, extra) => ({ id: `studio:${session}:${id}`, source: 'studio', session, ...extra });
  const graph = buildGraph([], [
    node('a', 'ev', { kind: 'remote', class: 'RemoteEvent', name: 'Dano' }),
    node('a', 'cli', { kind: 'client', name: 'Arma', sends: ['Dano'], imports: ['NoExiste'] }),
    node('a', 'srv', { kind: 'server', name: 'Combate', listens: ['Dano'] }),
    node('a', 'm1', { kind: 'module', name: 'Uno', imports: ['Dos'] }),
    node('a', 'm2', { kind: 'module', name: 'Dos', imports: ['Uno'] }),
    node('b', 'm3', { kind: 'module', name: 'Uno' }), // otra ventana: no es duplicado / another window: not a duplicate
  ]);
  const has = (type, source, target) => graph.links.some((l) => l.type === type && l.source === source && l.target === target);
  assert.ok(has('signal', 'studio:a:cli', 'studio:a:ev'));
  assert.ok(has('signal', 'studio:a:ev', 'studio:a:srv'));
  assert.ok(!has('requires', 'studio:a:m2', 'studio:b:m3'));

  const types = graph.issues.map((i) => i.type).sort();
  assert.deepEqual(types, ['broken-require', 'cycle', 'unused-module']);
  assert.equal(graph.issues.find((i) => i.type === 'unused-module').ids[0], 'studio:b:m3');
});

test('recent activity: a place connecting is not activity, a new script is', () => {
  const { config } = makeProject();
  const project = new Project(config);
  project.rebuild();
  const tree = [
    { id: 'rs', name: 'ReplicatedStorage', class: 'ReplicatedStorage' },
    ...Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, name: `Mod${i}`, class: 'ModuleScript', parent: 'rs' })),
  ];
  project.studio.setTree('1', 'Place', tree);
  project.rebuild();
  assert.equal(project.graph.nodes.filter((n) => n.changedAt).length, 0);

  project.studio.setTree('1', 'Place', [...tree, { id: 'new', name: 'Nuevo', class: 'Script', parent: 'rs' }]);
  project.rebuild();
  project.close();
  assert.deepEqual(project.graph.nodes.filter((n) => n.changedAt).map((n) => n.name), ['Nuevo']);
});

test('server: saves files, detects conflicts and blocks foreign hosts/origins', async () => {
  const { root, config } = makeProject();
  const project = new Project(config);
  project.rebuild();
  const server = createServer(project);
  await new Promise((resolve) => server.listen(config.port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${config.port}`;
  const host = {};

  try {
    const node = await (await fetch(`${base}/api/node?id=${encodeURIComponent('disk:notes.md')}`, { headers: host })).json();
    assert.equal(node.content, '# hi\n');

    const save = (body, headers = {}) => fetch(`${base}/api/save`, {
      method: 'POST',
      headers: { ...host, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

    const ok = await save({ id: 'disk:notes.md', content: '# edited\n', base: node.base });
    assert.equal(ok.status, 200);
    assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), '# edited\n');

    // Base antigua → conflicto, sin pisar el archivo / Old base → conflict, file untouched
    const conflict = await save({ id: 'disk:notes.md', content: 'lost', base: node.base });
    assert.equal(conflict.status, 409);
    assert.equal(fs.readFileSync(path.join(root, 'notes.md'), 'utf8'), '# edited\n');

    // Ids que intentan salir de la carpeta no existen / Ids escaping the folder don't exist
    const escape = await save({ id: 'disk:../outside.txt', content: 'x', base: '0' });
    assert.equal(escape.status, 404);

    const evilOrigin = await save({ id: 'disk:notes.md', content: 'x', base: '0' }, { Origin: 'https://evil.example' });
    assert.equal(evilOrigin.status, 403);

    // fetch() no deja cambiar Host, así que usamos http directamente (ataque DNS rebinding).
    // fetch() won't let us set Host, so we use http directly (DNS rebinding attack).
    const evilHostStatus = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: config.port, path: '/api/graph', headers: { Host: 'evil.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      }).on('error', reject);
    });
    assert.equal(evilHostStatus, 403);
  } finally {
    server.close();
    project.close();
  }
});
