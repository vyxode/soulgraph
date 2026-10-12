// Empaqueta las librerías del panel en public/vendor/, para que SoulGraph funcione sin internet
// y sin `npm install` para el usuario final. Solo hace falta al actualizar esas librerías:
//   npm install && npm run build:vendor
//
// Bundles the panel libraries into public/vendor/, so SoulGraph works offline and end users
// never need `npm install`. Only needed when updating those libraries:
//   npm install && npm run build:vendor

import { build } from 'esbuild';

const bundles = {
  'graph-bundle.js': 'scripts/vendor/graph-entry.js', // 3d-force-graph + three + bloom
  'editor-bundle.js': 'scripts/vendor/editor-entry.js', // CodeMirror 6
};

for (const [out, entry] of Object.entries(bundles)) {
  await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'iife',
    legalComments: 'eof',
    outfile: `public/vendor/${out}`,
  });
  console.log(`public/vendor/${out} ✔`);
}
