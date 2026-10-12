'use strict';
// Registro de analizadores.
// Analyzer registry.
//
// Un analizador es un objeto { name, test(info), analyze(text, info) }.
// `analyze` devuelve cualquier combinación de:
//   symbols: nombres que define el archivo (funciones, clases...)
//   imports: nombres de módulos que usa (se enlazan con otros nodos por nombre)
//   refs:    nombres de archivo que menciona
//
// An analyzer is an object { name, test(info), analyze(text, info) }.
// `analyze` returns any combination of:
//   symbols: names the file defines (functions, classes...)
//   imports: module names it uses (linked to other nodes by name)
//   refs:    file names it mentions
//
// Para añadir un lenguaje (Python, C#...) crea un archivo en esta carpeta y añádelo aquí.
// To add a language (Python, C#...) create a file in this folder and add it here.

const ANALYZERS = [
  require('./lua'),
  require('./references'),
];

function analyze(text, info) {
  const result = { symbols: [], imports: [], refs: [] };

  for (const analyzer of ANALYZERS) {
    if (!analyzer.test(info)) continue;
    try {
      const out = analyzer.analyze(text, info);
      for (const key of Object.keys(result)) {
        if (out[key]) result[key].push(...out[key]);
      }
    } catch (err) {
      // Un analizador roto no debe tumbar el escaneo entero.
      // A broken analyzer must not take the whole scan down.
      console.warn(`[soulgraph] analyzer "${analyzer.name}" failed on ${info.path}: ${err.message}`);
    }
  }

  return result;
}

module.exports = { analyze, ANALYZERS };
