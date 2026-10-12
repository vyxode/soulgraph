'use strict';
// Pruebas de los analizadores / Analyzer tests
const test = require('node:test');
const assert = require('node:assert/strict');
const lua = require('../src/analyzers/lua');
const references = require('../src/analyzers/references');

test('lua: resolves require() targets', () => {
  assert.equal(lua.requireTarget('RS:WaitForChild("Ciclo")'), 'Ciclo');
  assert.equal(lua.requireTarget("game.ReplicatedStorage:FindFirstChild('Mod')"), 'Mod');
  assert.equal(lua.requireTarget('script.Parent.Utils'), 'Utils');
  assert.equal(lua.requireTarget('RS.Mod:Clone()'), 'Mod');
  assert.equal(lua.requireTarget('variable'), null);
  assert.equal(lua.requireTarget('12345'), null);
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
