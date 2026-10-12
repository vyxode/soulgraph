'use strict';
// Servidor MCP de SoulGraph: herramientas para que Claude consulte y edite el proyecto.
// SoulGraph MCP server: tools so Claude can query and edit the project.
//
// Habla MCP por stdin/stdout (JSON-RPC, un mensaje por línea), sin dependencias.
// Si el panel no está encendido para este proyecto, lo enciende él mismo: así basta con
// abrir Claude para tener mapa, panel y sincronización con Studio.
//
// Speaks MCP over stdin/stdout (JSON-RPC, one message per line), with no dependencies.
// If the panel isn't running for this project, it starts it itself: opening Claude is
// enough to get the map, the panel and the Studio sync.
//
// IMPORTANTE: stdout es solo para el protocolo; todo lo demás va a stderr.
// IMPORTANT: stdout is for the protocol only; everything else goes to stderr.

const path = require('path');
const readline = require('readline');
const { loadConfig } = require('./config');
const { Project } = require('./project');
const { createServer } = require('./server');
const { pathOf } = require('./graph');
const pkg = require('../package.json');

const MAX_CONTENT_LINES = 3000;

const INSTRUCTIONS = [
  'SoulGraph keeps a live graph of this project: files on disk and the open Roblox Studio places',
  '(scripts, modules, functions, RemoteEvents, folders, models, attributes).',
  'Use soulgraph_overview first, then soulgraph_find / soulgraph_search_code to locate things,',
  'and soulgraph_node to read one item with its connections. Prefer these over opening files one by one.',
  'Studio scripts can be edited with soulgraph_edit (Studio must be open with the SoulGraph plugin).',
].join(' ');

// ---------- Herramientas / Tools ----------

const target = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Node id from another SoulGraph result' },
    path: { type: 'string', description: 'Node path, e.g. "Place/ReplicatedStorage/CicloDiaNoche" or "Mapa/karakura.mtl". A unique name also works.' },
  },
};

const TOOLS = [
  {
    name: 'soulgraph_overview',
    description: 'Project overview: Studio places, counts by kind, health issues, and every script/module with its path. Start here.',
    inputSchema: { type: 'object', properties: {} },
    run: overview,
  },
  {
    name: 'soulgraph_find',
    description: 'Find nodes (files, scripts, modules, functions, events, instances) by name, path or defined function.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: find,
  },
  {
    name: 'soulgraph_search_code',
    description: 'Search text inside every script and text file. Returns path:line and the matching line.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Max results (default 100)' } },
      required: ['query'],
    },
    run: searchCode,
  },
  {
    name: 'soulgraph_node',
    description: 'Everything about one node: kind, attributes, tags, functions, what it requires/calls/fires, who uses it, children, and its source code.',
    inputSchema: {
      ...target,
      properties: { ...target.properties, include_content: { type: 'boolean', description: 'Include source code (default true)' } },
    },
    run: nodeDetails,
  },
  {
    name: 'soulgraph_health',
    description: 'Project health: broken requires, circular requires, duplicate module names, possibly unused modules, events nobody fires or listens to.',
    inputSchema: { type: 'object', properties: {} },
    run: health,
  },
  {
    name: 'soulgraph_edit',
    description: 'Edit a Studio script or a text file. Either replace one exact, unique `old_text` with `new_text`, or pass the whole new `content`. Changes reach Studio live and can be undone there with Ctrl+Z.',
    inputSchema: {
      ...target,
      properties: {
        ...target.properties,
        old_text: { type: 'string' },
        new_text: { type: 'string' },
        content: { type: 'string', description: 'Full new content (instead of old_text/new_text)' },
      },
    },
    run: edit,
  },
  {
    name: 'soulgraph_open_in_studio',
    description: 'Select an instance in Roblox Studio and, for scripts, open it (optionally at a line).',
    inputSchema: { ...target, properties: { ...target.properties, line: { type: 'number' } } },
    run: openInStudio,
  },
];

// ---------- Implementación / Implementation ----------

let baseUrl = '';
let currentConfig = null;

async function api(route, body) {
  const request = () => fetch(`${baseUrl}${route}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let res;
  try {
    res = await request();
  } catch {
    // El panel que usábamos se cerró (p. ej. otra sesión de Claude): encendemos uno y reintentamos.
    // The panel we were using closed (e.g. another Claude session): start one and retry.
    await ensureServer(currentConfig);
    res = await request();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function loadGraph() {
  const graph = await api('/api/graph');
  graph.byId = new Map(graph.nodes.map((n) => [n.id, n]));
  graph.label = (n) => pathOf(n, graph.byId);
  return graph;
}

// Acepta id, ruta exacta o un nombre que no se repita / Accepts id, exact path or a unique name
function resolveNode(graph, args) {
  if (args.id && graph.byId.has(args.id)) return graph.byId.get(args.id);
  const wanted = String(args.path || args.id || '').replace(/\\/g, '/').toLowerCase();
  if (!wanted) throw new Error('Pass `id` or `path`.');
  const byPath = graph.nodes.filter((n) => graph.label(n).toLowerCase() === wanted);
  if (byPath.length === 1) return byPath[0];
  const bySuffix = graph.nodes.filter((n) => graph.label(n).toLowerCase().endsWith(`/${wanted}`) || n.name.toLowerCase() === wanted);
  if (bySuffix.length === 1) return bySuffix[0];
  if (!bySuffix.length && !byPath.length) throw new Error(`Nothing called "${args.path || args.id}". Try soulgraph_find.`);
  const options = [...byPath, ...bySuffix].slice(0, 10).map((n) => `- ${graph.label(n)} (id: ${n.id})`).join('\n');
  throw new Error(`"${args.path || args.id}" is ambiguous. Use one of:\n${options}`);
}

function line(graph, n) {
  const extra = [n.kind, n.class && n.class !== n.kind ? n.class : null, n.lines != null ? `${n.lines} lines` : null].filter(Boolean);
  return `- ${graph.label(n)} (${extra.join(', ')}) · id: ${n.id}`;
}

async function overview() {
  const graph = await loadGraph();
  const out = [`# ${graph.project}`, ''];

  const sessions = graph.studio.sessions || [];
  out.push(sessions.length
    ? sessions.map((s) => `Studio: ${s.place} — ${s.connected ? 'live' : 'offline (last snapshot)'}`).join('\n')
    : 'Studio: never connected (install the SoulGraph Studio plugin).');
  out.push('');

  const counts = {};
  for (const n of graph.nodes) counts[`${n.source}/${n.kind}`] = (counts[`${n.source}/${n.kind}`] || 0) + 1;
  out.push(`Counts: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out.push(`Health issues: ${graph.issues.length}${graph.issues.length ? ' (see soulgraph_health)' : ''}`);
  out.push('');

  const code = graph.nodes.filter((n) => ['server', 'client', 'module'].includes(n.kind) || (n.kind === 'code' && n.source === 'disk'));
  out.push('## Scripts');
  for (const n of code.sort((a, b) => graph.label(a).localeCompare(graph.label(b)))) out.push(line(graph, n));

  const events = graph.nodes.filter((n) => n.kind === 'remote');
  if (events.length) {
    out.push('', '## Events');
    for (const n of events) out.push(line(graph, n));
  }
  return out.join('\n');
}

async function find({ query }) {
  const graph = await loadGraph();
  const q = String(query || '').toLowerCase();
  const rank = (n) => {
    const name = n.name.toLowerCase();
    if (name === q) return 0;
    if (name.startsWith(q)) return 1;
    if (name.includes(q)) return 2;
    if (graph.label(n).toLowerCase().includes(q)) return 3;
    if ((n.symbols || []).some((s) => s.toLowerCase().includes(q))) return 4;
    return -1;
  };
  const hits = graph.nodes.map((n) => [rank(n), n]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).slice(0, 40);
  return hits.length ? hits.map(([, n]) => line(graph, n)).join('\n') : `Nothing matches "${query}".`;
}

async function searchCode({ query, limit }) {
  const data = await api(`/api/search?q=${encodeURIComponent(query || '')}&limit=${Number(limit) || 100}`);
  if (!data.total) return `No code contains "${query}".`;
  const rows = data.results.map((r) => `${r.path}:${r.line}: ${r.text}`);
  if (data.total > data.results.length) rows.push(`… ${data.total - data.results.length} more`);
  return rows.join('\n');
}

async function nodeDetails(args) {
  const graph = await loadGraph();
  const n = resolveNode(graph, args);
  const out = [`# ${graph.label(n)}`, `id: ${n.id} · kind: ${n.kind}${n.class ? ` · class: ${n.class}` : ''}${n.lines != null ? ` · ${n.lines} lines` : ''}`];

  if (n.attrs) out.push(`attributes: ${Object.entries(n.attrs).map(([k, a]) => `${k}=${a.value} (${a.type})`).join(', ')}`);
  if (n.tags) out.push(`tags: ${n.tags.join(', ')}`);
  if (n.symbols) out.push(`defines: ${n.symbols.join(', ')}`);

  const related = (type, dir) => graph.links
    .filter((l) => l.type === type && (dir === 'out' ? l.source === n.id : l.target === n.id))
    .map((l) => graph.byId.get(dir === 'out' ? l.target : l.source))
    .filter(Boolean)
    .map((m) => graph.label(m));
  const groups = [
    ['requires', related('requires', 'out')],
    ['required by', related('requires', 'in')],
    ['calls', related('calls', 'out')],
    ['called by', related('calls', 'in')],
    ['fires', n.kind === 'remote' ? [] : related('signal', 'out')],
    ['listens to', n.kind === 'remote' ? [] : related('signal', 'in')],
    ['fired by', n.kind === 'remote' ? related('signal', 'in') : []],
    ['heard by', n.kind === 'remote' ? related('signal', 'out') : []],
    ['mentions', related('references', 'out')],
    ['children', related('contains', 'out').slice(0, 50)],
  ];
  for (const [title, list] of groups) if (list.length) out.push(`${title}: ${list.join(', ')}`);

  const issues = graph.issues.filter((i) => i.ids.includes(n.id));
  if (issues.length) out.push(`health: ${issues.map((i) => i.type + (i.detail ? ` (${i.detail})` : '')).join(', ')}`);

  if (args.include_content !== false && (n.editable || n.kind === 'function')) {
    const data = await api(`/api/node?id=${encodeURIComponent(n.id)}`);
    if (typeof data.content === 'string') {
      const lines = data.content.split('\n');
      const shown = lines.slice(0, MAX_CONTENT_LINES).map((text, i) => `${String(i + 1).padStart(5)}  ${text}`);
      out.push('', '```lua', ...shown, '```');
      if (lines.length > MAX_CONTENT_LINES) out.push(`(${lines.length - MAX_CONTENT_LINES} more lines; use soulgraph_search_code to find a spot)`);
    }
  }
  return out.join('\n');
}

async function health() {
  const graph = await loadGraph();
  if (!graph.issues.length) return 'No health issues found.';
  return graph.issues.map((i) => `- ${i.type}${i.detail ? ` "${i.detail}"` : ''}: ${i.ids.map((id) => (graph.byId.has(id) ? graph.label(graph.byId.get(id)) : id)).join(i.type === 'cycle' ? ' → ' : ', ')}`).join('\n');
}

async function edit(args) {
  const graph = await loadGraph();
  const n = resolveNode(graph, args);
  const current = await api(`/api/node?id=${encodeURIComponent(n.id)}`);
  if (typeof current.content !== 'string') throw new Error(`${graph.label(n)} has no editable text.`);

  let content;
  if (typeof args.content === 'string') {
    content = args.content;
  } else if (typeof args.old_text === 'string' && typeof args.new_text === 'string') {
    const count = current.content.split(args.old_text).length - 1;
    if (count === 0) throw new Error('old_text was not found. Read the node again: it may have changed.');
    if (count > 1) throw new Error(`old_text appears ${count} times; include more surrounding lines so it is unique.`);
    content = current.content.replace(args.old_text, () => args.new_text);
  } else {
    throw new Error('Pass old_text + new_text, or content.');
  }

  try {
    await api('/api/save', { id: current.editId, content, base: current.base });
  } catch (err) {
    if (err.status === 409) throw new Error('It changed while editing (someone else saved). Read it again and retry.');
    throw err;
  }
  return `Saved ${graph.label(graph.byId.get(current.editId) || n)}.`;
}

async function openInStudio(args) {
  const graph = await loadGraph();
  const n = resolveNode(graph, args);
  await api('/api/studio/command', { type: 'open', id: n.id, line: args.line });
  return `Opened ${graph.label(n)} in Studio.`;
}

// ---------- Arranque / Startup ----------

// Usa el servidor que ya esté encendido para este proyecto, o enciende uno aquí.
// Uses the server already running for this project, or starts one here.
async function ensureServer(config) {
  currentConfig = config;
  baseUrl = `http://127.0.0.1:${config.port}`;
  try {
    const res = await fetch(`${baseUrl}/api/graph`);
    const info = await res.json();
    if (path.resolve(info.root || '') === config.root) return;
    throw new Error(`Port ${config.port} is used by another SoulGraph project (${info.root}). Set another "port" in soulgraph.config.json.`);
  } catch (err) {
    if (err.message.startsWith('Port ')) throw err;
  }

  const project = new Project(config);
  project.rebuild();
  project.write();
  project.watch();
  const server = createServer(project);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', resolve);
  });
  process.stderr.write(`[soulgraph] panel: http://localhost:${config.port}\n`);
  const stop = () => {
    project.close();
    process.exit(0);
  };
  process.stdin.on('end', stop);
  process.on('SIGTERM', stop);
}

function startMcp(folder) {
  // ${CLAUDE_PROJECT_DIR} puede llegar sin sustituir; entonces usamos la carpeta actual.
  // ${CLAUDE_PROJECT_DIR} may arrive unsubstituted; then we use the current folder.
  const usable = folder && !folder.includes('${');
  const root = usable ? folder : process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const config = loadConfig(root);
  const ready = ensureServer(config).catch((err) => {
    process.stderr.write(`[soulgraph] ${err.message}\n`);
    return err;
  });

  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  readline.createInterface({ input: process.stdin }).on('line', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return fail(null, -32700, 'Parse error');
    }
    const { id, method, params = {} } = msg;
    if (id === undefined) return; // notificación / notification

    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'soulgraph', version: pkg.version },
        instructions: INSTRUCTIONS,
      });
    }
    if (method === 'ping') return reply(id, {});
    if (method === 'tools/list') {
      return reply(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool ${params.name}`);
      const startupError = await ready;
      if (startupError) return reply(id, { content: [{ type: 'text', text: startupError.message }], isError: true });
      try {
        const text = await tool.run(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text }] });
      } catch (err) {
        return reply(id, { content: [{ type: 'text', text: err.message }], isError: true });
      }
    }
    return fail(id, -32601, `Method not found: ${method}`);
  });
}

module.exports = { startMcp, TOOLS };
