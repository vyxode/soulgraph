'use strict';
// Analizador genérico de referencias entre archivos del disco.
// Generic analyzer for references between files on disk.
//
// Busca nombres de archivo dentro del texto: `mtllib karakura.mtl` en un .obj,
// `map_Kd Part1_diff.png` en un .mtl, `[ver](docs/guia.md)` en un Markdown...
// Looks for file names inside the text: `mtllib karakura.mtl` in an .obj,
// `map_Kd Part1_diff.png` in an .mtl, `[see](docs/guide.md)` in Markdown...

const { kindOfFile } = require('../kinds');

// Palabra con pinta de archivo: letras, números, guiones y puntos + extensión.
// A file-looking word: letters, digits, dashes and dots + an extension.
const FILE_TOKEN_RE = /[\w\-.]+\.[A-Za-z0-9]{1,5}\b/g;

module.exports = {
  name: 'references',

  // Solo para archivos del disco: los scripts de Studio no nombran archivos.
  // Disk files only: Studio scripts don't name files.
  test(info) {
    return info.source === 'disk';
  },

  analyze(text) {
    const refs = new Set();
    for (const [token] of text.matchAll(FILE_TOKEN_RE)) {
      const base = token.split(/[\\/]/).pop();
      // Solo extensiones conocidas, para no confundir `math.floor` con un archivo.
      // Known extensions only, so `math.floor` isn't mistaken for a file.
      if (kindOfFile(base) !== 'other') refs.add(base.toLowerCase());
    }
    return { refs: [...refs] };
  },
};
