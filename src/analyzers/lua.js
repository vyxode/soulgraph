'use strict';
// Analizador de Lua / Luau (scripts de Roblox, Rojo, LÖVE...).
// Lua / Luau analyzer (Roblox scripts, Rojo, LÖVE...).
//
// Extrae dos cosas: qué funciones define el archivo y qué módulos requiere.
// It extracts two things: which functions the file defines and which modules it requires.

// `function Foo.bar()`, `local function baz()`, `function M:qux()`
const FUNCTION_RE = /(?:^|\n)[ \t]*(?:local[ \t]+)?function[ \t]+([\w.:]+)/g;
// `M.algo = function(...)`
const ASSIGNED_FUNCTION_RE = /(?:^|\n)[ \t]*([\w.]+)[ \t]*=[ \t]*function\b/g;
// require(...) con un nivel de paréntesis dentro, p. ej. WaitForChild("X").
// require(...) allowing one level of nested parentheses, e.g. WaitForChild("X").
const REQUIRE_RE = /\brequire[ \t]*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

// Quita los comentarios para no contar código comentado.
// Strip comments so commented-out code isn't counted.
function stripComments(source) {
  return source
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
    .replace(/--[^\n]*/g, '');
}

// Del argumento de require() saca el nombre del módulo, si se puede saber sin ejecutar.
// From a require() argument, get the module name when it can be known statically.
//   require(RS:WaitForChild("Ciclo"))   → "Ciclo"
//   require(script.Parent.Utils)        → "Utils"
//   require(RS.Mod:Clone())             → "Mod"
//   require(variable) / require(12345)  → null
function requireTarget(arg) {
  const expr = arg.replace(/:Clone\(\s*\)\s*$/, '').trim();

  const quoted = expr.match(/["']([^"']+)["']\s*\)?\s*$/);
  if (quoted) return quoted[1];

  const dotted = expr.match(/[.:]([A-Za-z_]\w*)\s*$/);
  if (dotted) return dotted[1];

  return null;
}

module.exports = {
  name: 'lua',

  test(info) {
    return info.lang === 'lua' || info.ext === 'lua' || info.ext === 'luau';
  },

  analyze(source) {
    const code = stripComments(source);
    const symbols = new Set();
    const imports = new Set();

    for (const m of code.matchAll(FUNCTION_RE)) symbols.add(m[1]);
    for (const m of code.matchAll(ASSIGNED_FUNCTION_RE)) symbols.add(m[1]);
    for (const m of code.matchAll(REQUIRE_RE)) {
      const target = requireTarget(m[1]);
      if (target) imports.add(target);
    }

    return { symbols: [...symbols], imports: [...imports] };
  },

  // Exportado para los tests / Exported for tests
  requireTarget,
};
