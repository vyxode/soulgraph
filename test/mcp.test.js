'use strict';
// Prueba del servidor MCP hablando con él como lo haría Claude.
// Tests the MCP server by talking to it the way Claude would.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

test('mcp: initialize, list tools, overview, find and edit a file', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soulgraph-mcp-'));
  const port = 7800 + Math.floor(Math.random() * 90);
  fs.writeFileSync(path.join(root, 'soulgraph.config.json'), JSON.stringify({ port }));
  fs.writeFileSync(path.join(root, 'Utils.lua'), 'local M = {}\nfunction M.sum(a, b) return a + b end\nreturn M\n');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'cli', 'soulgraph.js'), 'mcp', root], { stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
  });
  let nextId = 1;
  const call = (method, params = {}) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const tool = async (name, args = {}) => (await call('tools/call', { name, arguments: args })).result;

  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test' } });
    assert.equal(init.result.serverInfo.name, 'soulgraph');

    const list = await call('tools/list');
    assert.ok(list.result.tools.some((t) => t.name === 'soulgraph_edit'));

    const overview = await tool('soulgraph_overview');
    assert.match(overview.content[0].text, /Utils\.lua/);

    const found = await tool('soulgraph_find', { query: 'sum' });
    assert.match(found.content[0].text, /Utils\.lua#M\.sum/);

    const edited = await tool('soulgraph_edit', { path: 'Utils.lua', old_text: 'a + b', new_text: 'a + b + 0' });
    assert.ok(!edited.isError, edited.content[0].text);
    assert.match(fs.readFileSync(path.join(root, 'Utils.lua'), 'utf8'), /a \+ b \+ 0/);

    const ambiguous = await tool('soulgraph_edit', { path: 'Utils.lua', old_text: 'nope', new_text: 'x' });
    assert.ok(ambiguous.isError);
  } finally {
    child.kill();
  }
});
