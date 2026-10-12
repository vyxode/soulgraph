'use strict';
// Analizador de Lua / Luau (scripts de Roblox, Rojo, LÖVE...).
// Lua / Luau analyzer (Roblox scripts, Rojo, LÖVE...).
//
// Extrae / Extracts:
//   symbols  funciones que define el archivo / functions the file defines
//   imports  módulos que requiere / modules it requires
//   calls    funciones de otros módulos que llama ("Modulo.funcion") / other modules' functions it calls
//   sends    eventos remotos que dispara (FireServer, Fire...) / remote events it fires
//   listens  eventos remotos que escucha (OnServerEvent...) / remote events it listens to

// `function Foo.bar()`, `local function baz()`, `function M:qux()`
const FUNCTION_RE = /(?:^|\n)[ \t]*(?:local[ \t]+)?function[ \t]+([\w.:]+)/g;
// `M.algo = function(...)`
const ASSIGNED_FUNCTION_RE = /(?:^|\n)[ \t]*([\w.]+)[ \t]*=[ \t]*function\b/g;
// require(...) con un nivel de paréntesis dentro, p. ej. WaitForChild("X").
// require(...) allowing one level of nested parentheses, e.g. WaitForChild("X").
const REQUIRE_RE = /\brequire[ \t]*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
// `local x = algo` (una sola variable) / `local x = something` (single variable)
const LOCAL_RE = /(?:^|\n)[ \t]*local[ \t]+([A-Za-z_]\w*)[ \t]*=[ \t]*([^\n]+)/g;
// `Modulo.funcion(` o `Modulo:funcion(` / `Module.fn(` or `Module:fn(`
const MEMBER_CALL_RE = /\b([A-Za-z_]\w*)[.:]([A-Za-z_]\w*)[ \t]*\(/g;
// Disparar un evento / Firing an event
const SEND_RE = /[.:](?:FireServer|FireClient|FireAllClients|InvokeServer|InvokeClient|Fire|Invoke)[ \t]*\(/g;
// Escuchar un evento / Listening to an event
const LISTEN_RE = /\.(?:(?:OnServerEvent|OnClientEvent|Event)[ \t]*:[ \t]*(?:Connect|Once|Wait|ConnectParallel)\b|(?:OnServerInvoke|OnClientInvoke|OnInvoke)[ \t]*=)/g;

// Quita los comentarios para no contar código comentado.
// Strip comments so commented-out code isn't counted.
function stripComments(source) {
  return source
    .replace(/--\[(=*)\[[\s\S]*?\]\1\]/g, '')
    .replace(/--[^\n]*/g, '');
}

// Último nombre de una expresión, si se puede saber sin ejecutar el código.
// Last name in an expression, when it can be known without running the code.
//   RS:WaitForChild("Ciclo")   → "Ciclo"
//   script.Parent.Utils        → "Utils"
//   RS.Mod:Clone()             → "Mod"
//   Remotes["Daño"]            → "Daño"
//   variable / 12345           → null
function lastName(expression) {
  const expr = expression.replace(/:Clone\(\s*\)\s*$/, '').trim();

  const quoted = expr.match(/["']([^"']+)["']\s*[)\]]?\s*$/);
  if (quoted) return quoted[1];

  const dotted = expr.match(/[.:]([A-Za-z_]\w*)\s*$/);
  if (dotted) return dotted[1];

  return null;
}

// Lee hacia atrás la expresión que hay justo antes de `pos` (p. ej. el objeto de `x:FireServer`).
// Reads backwards the expression right before `pos` (e.g. the object in `x:FireServer`).
function expressionBefore(code, pos) {
  let depth = 0;
  let i = pos - 1;
  for (; i >= 0; i--) {
    const c = code[i];
    if (c === ')' || c === ']') depth++;
    else if (c === '(' || c === '[') {
      if (depth === 0) break;
      depth--;
    } else if (depth === 0 && !/[\w.:"']/.test(c)) break;
  }
  return code.slice(i + 1, pos);
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
    const calls = new Set();
    const sends = new Set();
    const listens = new Set();

    for (const m of code.matchAll(FUNCTION_RE)) symbols.add(m[1]);
    for (const m of code.matchAll(ASSIGNED_FUNCTION_RE)) symbols.add(m[1]);
    for (const m of code.matchAll(REQUIRE_RE)) {
      const target = lastName(m[1]);
      if (target) imports.add(target);
    }

    // Variables locales: a qué módulo o instancia apuntan.
    // Local variables: which module or instance they point to.
    const moduleOf = new Map(); // variable → módulo / module
    const valueOf = new Map(); // variable → expresión / expression
    for (const [, name, value] of code.matchAll(LOCAL_RE)) {
      valueOf.set(name, value.trim());
      const req = value.match(/^require[ \t]*\(([\s\S]*)\)\s*$/);
      const target = req && lastName(req[1]);
      if (target) moduleOf.set(name, target);
    }

    for (const [, variable, fn] of code.matchAll(MEMBER_CALL_RE)) {
      if (moduleOf.has(variable)) calls.add(`${moduleOf.get(variable)}.${fn}`);
    }

    // A qué evento se refiere `objeto:FireServer(...)`, siguiendo una variable si hace falta.
    // Which event `object:FireServer(...)` refers to, following a variable if needed.
    const eventName = (pos) => {
      const expr = expressionBefore(code, pos);
      if (/^[A-Za-z_]\w*$/.test(expr)) return valueOf.has(expr) ? lastName(valueOf.get(expr)) : null;
      return lastName(expr);
    };
    for (const m of code.matchAll(SEND_RE)) {
      const name = eventName(m.index);
      if (name) sends.add(name);
    }
    for (const m of code.matchAll(LISTEN_RE)) {
      const name = eventName(m.index);
      if (name) listens.add(name);
    }

    return {
      symbols: [...symbols],
      imports: [...imports],
      calls: [...calls],
      sends: [...sends],
      listens: [...listens],
    };
  },

  // Exportado para los tests / Exported for tests
  lastName,
};
