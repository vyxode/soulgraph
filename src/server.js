'use strict';
// Servidor local del panel y del plugin de Studio. Sin dependencias: solo Node.
// Local server for the panel and the Studio plugin. No dependencies: plain Node.
//
// Seguridad / Security:
//   - Solo escucha en 127.0.0.1: nadie de fuera de tu PC puede entrar.
//     Only listens on 127.0.0.1: nobody outside your PC can reach it.
//   - Rechaza Host/Origin ajenos, para que una web cualquiera no pueda escribir tus archivos.
//     Rejects foreign Host/Origin headers, so a random website can't write your files.
//   - Las rutas de archivo nunca salen de la carpeta del proyecto.
//     File paths never escape the project folder.

const fs = require('fs');
const http = require('http');
const path = require('path');
const { SCRIPT_KINDS } = require('./studio');
const { searchCode } = require('./search');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function createServer(project) {
  const { port } = project.config;
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  const sseClients = new Set();

  // ---------- Tiempo real (Server-Sent Events) / Real time (Server-Sent Events) ----------

  const broadcast = (event, data) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) res.write(message);
  };

  project.on('graph', (version) => broadcast('graph', { version }));

  // El paso a "desconectado" no lo avisa nadie: lo comprobamos cada pocos segundos.
  // Going "disconnected" isn't announced by anyone: we check every few seconds.
  let lastStatus = JSON.stringify(project.studio.status().sessions.map((s) => s.connected));
  const statusTimer = setInterval(() => {
    const status = project.studio.status();
    const now = JSON.stringify(status.sessions.map((s) => s.connected));
    if (now !== lastStatus) broadcast('status', status);
    lastStatus = now;
  }, 3000);
  const keepAlive = setInterval(() => {
    for (const res of sseClients) res.write(': ping\n\n');
  }, 20000);

  // ---------- Rutas / Routes ----------

  const routes = {
    'GET /api/graph': () => ({
      version: project.version,
      project: project.name,
      root: project.config.root,
      studio: project.studio.status(),
      nodes: project.graph.nodes,
      links: project.graph.links,
      issues: project.graph.issues,
    }),

    // Buscar texto dentro del código de todo el proyecto / Search text inside all the project's code
    'GET /api/search': (req, url) => searchCode(project, url.searchParams.get('q') || '', {
      limit: Number(url.searchParams.get('limit')) || 200,
    }),

    'GET /api/node': (req, url) => {
      const node = findNode(url.searchParams.get('id'));
      // Una función se edita dentro de su módulo / A function is edited inside its module
      const target = editTarget(node);
      const result = { node, editId: target.id };

      if (target.source === 'disk' && target.editable) {
        const abs = project.disk.resolve(target.id);
        const stat = fs.statSync(abs);
        result.content = fs.readFileSync(abs, 'utf8');
        result.base = String(stat.mtimeMs);
      } else if (target.source === 'studio' && project.studio.sources.has(target.id)) {
        result.content = project.studio.sources.get(target.id);
        result.base = target.rev;
      }
      return result;
    },

    'GET /api/raw': (req, url, res) => {
      const node = findNode(url.searchParams.get('id'));
      const abs = node.source === 'disk' && node.kind === 'image' ? project.disk.resolve(node.id) : null;
      if (!abs) throw new HttpError(400, 'Only disk images can be previewed');
      res.writeHead(200, { 'Content-Type': MIME[node.ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(abs).on('error', () => res.destroy()).pipe(res);
    },

    'GET /api/events': (req, url, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`retry: 2000\nevent: graph\ndata: ${JSON.stringify({ version: project.version })}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
    },

    // Guardar un archivo del disco o un script de Studio.
    // Save a disk file or a Studio script.
    'POST /api/save': async (req) => {
      const { id, content, base } = await readJson(req);
      if (typeof content !== 'string') throw new HttpError(400, 'content must be a string');
      const node = editTarget(findNode(id));

      if (node.source === 'disk') return saveDiskFile(node, content, base);
      if (node.source === 'studio') return saveStudioScript(node, content, base);
      throw new HttpError(400, 'Unknown source');
    },

    // Órdenes para Studio: abrir/seleccionar o cambiar nombre y atributos.
    // Commands for Studio: open/select, or change name and attributes.
    'POST /api/studio/command': async (req) => {
      const body = await readJson(req);
      const node = editTarget(findNode(body.id));
      if (node.source !== 'studio' || !node.rawId) throw new HttpError(400, 'Not a Studio instance');
      requireStudio(node);

      if (body.type === 'open') {
        project.studio.enqueue(node, { type: 'open', line: Number(body.line) || undefined });
      } else if (body.type === 'props') {
        project.studio.enqueue(node, {
          type: 'props',
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined,
          attrs: cleanAttributes(body.attrs),
        });
      } else {
        throw new HttpError(400, 'Unknown command type');
      }
      return { ok: true };
    },

    // ----- Lo que llama el plugin de Studio / What the Studio plugin calls -----

    // Cada ventana de Studio se identifica con `session` / Each Studio window identifies itself with `session`
    'POST /api/studio/tree': async (req) => {
      const body = await readJson(req);
      return { need: project.studio.setTree(body.session, body.place, body.nodes) };
    },

    'POST /api/studio/sources': async (req) => {
      const body = await readJson(req);
      project.studio.setSources(body.session, body.items);
      return { ok: true };
    },

    'GET /api/studio/ping': (req, url) => {
      project.studio.touch(url.searchParams.get('session'));
      return { ok: true };
    },

    'GET /api/studio/poll': (req, url, res) => project.studio.poll(url.searchParams.get('session'), res),
  };

  // ---------- Ayudantes / Helpers ----------

  function findNode(id) {
    const node = typeof id === 'string' && project.byId.get(id);
    if (!node) throw new HttpError(404, 'Node not found');
    return node;
  }

  function requireStudio(node) {
    if (!project.studio.isConnectedNode(node)) throw new HttpError(503, 'Roblox Studio is not connected');
  }

  function editTarget(node) {
    return node.kind === 'function' ? findNode(node.parent) : node;
  }

  function saveDiskFile(node, content, base) {
    const abs = project.disk.resolve(node.id);
    if (!abs || !node.editable) throw new HttpError(400, 'This file cannot be edited');
    if (Buffer.byteLength(content) > project.config.maxTextBytes) throw new HttpError(413, 'File too large to edit');

    // Si alguien lo cambió mientras lo editabas, no lo pisamos: avisamos.
    // If someone changed it while you were editing, we don't overwrite: we warn.
    const current = String(fs.statSync(abs).mtimeMs);
    if (base !== current) {
      throw new HttpError(409, 'File changed on disk', { content: fs.readFileSync(abs, 'utf8'), base: current });
    }
    fs.writeFileSync(abs, content);
    project.scheduleRebuild({ disk: true });
    return { ok: true, base: String(fs.statSync(abs).mtimeMs) };
  }

  function saveStudioScript(node, content, base) {
    if (!SCRIPT_KINDS.has(node.kind)) throw new HttpError(400, 'Only scripts have source');
    requireStudio(node);
    if (base !== node.rev) {
      throw new HttpError(409, 'Script changed in Studio', { content: project.studio.sources.get(node.id), base: node.rev });
    }
    project.studio.enqueue(node, { type: 'source', source: content });
    // Lo damos por hecho ya; el plugin confirmará con el mismo código.
    // Assume it's done now; the plugin will confirm with the same source.
    project.studio.setSource(node.id, content);
    project.studio.changed();
    return { ok: true, base: node.rev };
  }

  // ---------- Petición HTTP / HTTP request ----------

  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(req.headers.host)) throw new HttpError(403, 'Forbidden host');
      if (req.method !== 'GET' && req.headers.origin && !allowedOrigins.has(req.headers.origin)) {
        throw new HttpError(403, 'Forbidden origin');
      }

      const url = new URL(req.url, `http://${req.headers.host}`);
      const route = routes[`${req.method} ${url.pathname}`];

      if (route) {
        const result = await route(req, url, res);
        if (result !== undefined) sendJson(res, 200, result);
      } else if (req.method === 'GET') {
        serveStatic(url.pathname, res);
      } else {
        throw new HttpError(404, 'Not found');
      }
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error('[soulgraph]', err);
      if (!res.headersSent) sendJson(res, status, { error: err.message, ...err.extra });
      else res.end();
    }
  });

  server.on('close', () => {
    clearInterval(statusTimer);
    clearInterval(keepAlive);
    for (const res of sseClients) res.end();
  });

  return server;
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    throw new HttpError(404, 'Not found');
  }
  const ext = path.extname(file).slice(1);
  // Sin caché: al actualizar SoulGraph basta con recargar / No cache: after updating SoulGraph a reload is enough
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': MIME.json, 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Body too large'));
        req.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// Solo se aceptan atributos simples (texto, número, sí/no).
// Only simple attributes are accepted (text, number, true/false).
function cleanAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return undefined;
  const clean = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (!/^[A-Za-z0-9_]{1,100}$/.test(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
}

module.exports = { createServer, cleanAttributes };
