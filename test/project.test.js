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
  const need = project.studio.setTree('Test Place', [
    { id: 'rs', name: 'ReplicatedStorage', class: 'ReplicatedStorage' },
    { id: 'mod', name: 'Ciclo', class: 'ModuleScript', parent: 'rs' },
    { id: 'sss', name: 'ServerScriptService', class: 'ServerScriptService' },
    { id: 'main', name: 'Main', class: 'Script', parent: 'sss' },
  ]);
  assert.deepEqual(need.sort(), ['main', 'mod']);

  project.studio.setSources([
    { id: 'mod', source: 'local M = {}\nfunction M.go() end\nreturn M' },
    { id: 'main', source: 'require(game.ReplicatedStorage.Ciclo).go()' },
  ]);
  project.rebuild();
  project.close();

  assert.ok(project.graph.links.some((l) => l.type === 'requires' && l.source === 'studio:main' && l.target === 'studio:mod'));
  const mirror = path.join(root, '.soulgraph', 'studio', 'ServerScriptService', 'Main.server.lua');
  assert.equal(fs.readFileSync(mirror, 'utf8'), 'require(game.ReplicatedStorage.Ciclo).go()');
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
