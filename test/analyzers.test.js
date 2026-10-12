'use strict';
// Pruebas de los analizadores / Analyzer tests
const test = require('node:test');
const assert = require('node:assert/strict');
const lua = require('../src/analyzers/lua');
const references = require('../src/analyzers/references');

test('lua: resolves the last name of an expression', () => {
  assert.equal(lua.lastName('RS:WaitForChild("Ciclo")'), 'Ciclo');
  assert.equal(lua.lastName("game.ReplicatedStorage:FindFirstChild('Mod')"), 'Mod');
  assert.equal(lua.lastName('script.Parent.Utils'), 'Utils');
  assert.equal(lua.lastName('RS.Mod:Clone()'), 'Mod');
  assert.equal(lua.lastName('variable'), null);
  assert.equal(lua.lastName('12345'), null);
  assert.equal(lua.lastName('Remotes["Daño"]'), 'Daño');
});

test('lua: finds calls to other modules\' functions', () => {
  const source = [
    'local Ciclo = require(game.ReplicatedStorage:WaitForChild("CicloDiaNoche"))',
    'local K = require(script.Parent.ConstructorKarakura)',
    'Ciclo.Aplicar(12)',
    'K:Colocar(x)',
    'math.floor(2)',
  ].join('\n');
  assert.deepEqual(lua.analyze(source).calls.sort(), ['CicloDiaNoche.Aplicar', 'ConstructorKarakura.Colocar']);
});

test('lua: finds remote events fired and listened', () => {
  const source = [
    'local RS = game:GetService("ReplicatedStorage")',
    'local dano = RS:WaitForChild("Remotes"):WaitForChild("Dano")',
    'dano:FireServer(10)',
    'RS.Remotes.Curar:FireServer()',
    'RS.Remotes["Hollow Spawn"].OnClientEvent:Connect(function() end)',
    'RS.Remotes.Ping.OnServerInvoke = function() return true end',
    'signal:Fire()', // variable desconocida / unknown variable → ignored
  ].join('\n');
  const result = lua.analyze(source);
  assert.deepEqual(result.sends.sort(), ['Curar', 'Dano']);
  assert.deepEqual(result.listens.sort(), ['Hollow Spawn', 'Ping']);
});

test('lua: finds functions and requires, ignoring comments', () => {
  const source = [
    'local A = require(game.ReplicatedStorage:WaitForChild("Alpha"))',
    '-- local B = require(script.Beta)',
    '--[[ require(script.Gamma) ]]',
    'local M = {}',
    'function M.uno() end',
    'local function dos() end',
    'M.tres = function() end',
    'function M:cuatro() end',
    'return M',
  ].join('\n');
  const result = lua.analyze(source);
  assert.deepEqual(result.imports, ['Alpha']);
  assert.deepEqual(result.symbols.sort(), ['M.tres', 'M.uno', 'M:cuatro', 'dos'].sort());
});

test('references: finds known file names only', () => {
  const { refs } = references.analyze('mtllib karakura.mtl\nmap_Kd Textures/Part1_diff.png\nmath.floor(x)');
  assert.deepEqual(refs.sort(), ['karakura.mtl', 'part1_diff.png']);
});
