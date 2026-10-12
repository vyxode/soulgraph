// Empaqueta las librerías del panel (3d-force-graph + three + bloom) en un solo archivo,
// para que SoulGraph funcione sin internet y sin `npm install` para el usuario final.
// Solo hace falta ejecutarlo al actualizar esas librerías: `npm install && npm run build:vendor`.
//
// Bundles the panel libraries (3d-force-graph + three + bloom) into a single file,
// so SoulGraph works offline and end users never need `npm install`.
// Only run it when updating those libraries: `npm install && npm run build:vendor`.

import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';

const entry = `
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
window.SoulVendor = { ForceGraph3D, THREE, UnrealBloomPass };
`;

writeFileSync('scripts/.vendor-entry.js', entry);

await build({
  entryPoints: ['scripts/.vendor-entry.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  legalComments: 'eof',
  outfile: 'public/vendor/graph-bundle.js',
});

console.log('public/vendor/graph-bundle.js ✔');
