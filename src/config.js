'use strict';
// Configuración de SoulGraph.
// SoulGraph configuration.
//
// Cada proyecto puede tener su propio `soulgraph.config.json` en la raíz;
// lo que ponga ahí se mezcla con estos valores por defecto.
// Each project may ship its own `soulgraph.config.json` at its root;
// whatever it sets is merged on top of these defaults.

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  // Puerto del panel / Panel port
  port: 7777,

  // Carpetas o archivos que nunca entran en el grafo (por nombre).
  // Folders or files that never enter the graph (matched by name).
  ignore: ['.git', 'node_modules', '.soulgraph', '.claude', '.vscode', '.idea'],

  // Por encima de este tamaño un archivo de texto no se edita desde el panel.
  // Text files above this size can't be edited from the panel.
  maxTextBytes: 1024 * 1024,

  // De los archivos grandes solo se lee el principio para buscar referencias
  // (por ejemplo, el `mtllib` de un .obj de 600 MB).
  // Big files are only sampled at the start to find references
  // (e.g. the `mtllib` line of a 600 MB .obj).
  sampleBytes: 64 * 1024,
};

function loadConfig(root) {
  const file = path.join(root, 'soulgraph.config.json');
  let user = {};

  if (fs.existsSync(file)) {
    try {
      user = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.warn(`[soulgraph] soulgraph.config.json no es JSON válido / is not valid JSON: ${err.message}`);
    }
  }

  return {
    ...DEFAULTS,
    ...user,
    // Las ignoradas se suman, no se reemplazan / Ignores are added, not replaced
    ignore: [...new Set([...DEFAULTS.ignore, ...(user.ignore || [])])],
    root: path.resolve(root),
  };
}

module.exports = { loadConfig, DEFAULTS };
