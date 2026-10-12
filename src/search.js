'use strict';
// Búsqueda de texto dentro del código de todo el proyecto.
// Text search inside the code of the whole project.
// Las usan el panel y las herramientas MCP de Claude / Used by the panel and Claude's MCP tools.

const fs = require('fs');
const { pathOf } = require('./graph');

// Busca un texto en todos los scripts y archivos de texto, línea a línea.
// Searches a text in every script and text file, line by line.
function searchCode(project, query, { limit = 200 } = {}) {
  const q = String(query).toLowerCase().trim();
  const results = [];
  let total = 0;
  if (!q) return { query, total, results };

  for (const n of project.graph.nodes) {
    if (!n.editable) continue;
    const text = n.source === 'studio' ? project.studio.sources.get(n.id) : readText(project, n);
    if (!text) continue;

    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(q)) continue;
      total++;
      if (results.length < limit) {
        results.push({ id: n.id, name: n.name, path: pathOf(n, project.byId), line: i + 1, text: lines[i].trim().slice(0, 200) });
      }
    }
  }
  return { query, total, results };
}

function readText(project, node) {
  const abs = project.disk.resolve(node.id);
  try {
    return abs ? fs.readFileSync(abs, 'utf8') : null;
  } catch {
    return null;
  }
}

module.exports = { searchCode };
