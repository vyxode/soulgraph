#!/usr/bin/env node
'use strict';
// Línea de comandos de SoulGraph.
// SoulGraph command line.
//
//   soulgraph [serve] [carpeta|folder] [--port 7777] [--no-open]
//   soulgraph build [carpeta|folder]
//   soulgraph init  [carpeta|folder]

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('../src/config');
const { Project } = require('../src/project');
const { createServer } = require('../src/server');
const pkg = require('../package.json');

const HELP = `
SoulGraph ${pkg.version} — by Vyxode

  soulgraph [serve] [folder]   Panel en vivo + mapa para Claude / Live panel + map for Claude
  soulgraph build [folder]     Solo regenera .soulgraph/ / Only regenerates .soulgraph/
  soulgraph init [folder]      Añade la config y el aviso en CLAUDE.md / Adds config and CLAUDE.md note

Options:
  --port <n>    Puerto del panel / Panel port (default 7777)
  --no-open     No abrir el navegador / Don't open the browser
`;

function parseArgs(argv) {
  const args = { command: 'serve', folder: '.', port: null, open: true };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port') args.port = Number(argv[++i]);
    else if (arg === '--no-open') args.open = false;
    else if (arg === '-h' || arg === '--help') args.command = 'help';
    else if (arg === '-v' || arg === '--version') args.command = 'version';
    else rest.push(arg);
  }
  if (['serve', 'build', 'init'].includes(rest[0])) args.command = rest.shift();
  if (rest[0]) args.folder = rest[0];
  return args;
}

function serve(args) {
  const config = loadConfig(args.folder);
  if (args.port) config.port = args.port;

  const project = new Project(config);
  project.rebuild();
  project.write();
  project.watch();

  const server = createServer(project);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[soulgraph] El puerto ${config.port} está ocupado (¿ya está abierto?). / Port ${config.port} is busy (already running?). Try --port.`);
    } else {
      console.error('[soulgraph]', err.message);
    }
    process.exit(1);
  });

  server.listen(config.port, '127.0.0.1', () => {
    const url = `http://localhost:${config.port}`;
    console.log(`\n  SoulGraph · ${project.name}`);
    console.log(`  Panel:  ${url}`);
    console.log(`  Mapa / Map: ${path.join(project.outDir, 'MAP.md')}`);
    console.log('  Ctrl+C para salir / to quit\n');
    if (args.open) openBrowser(url);
  });

  // Al salir guardamos todo lo pendiente / Save everything pending on exit
  const stop = () => {
    project.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

function build(args) {
  const project = new Project(loadConfig(args.folder));
  project.rebuild();
  project.close();
  console.log(`[soulgraph] ${project.graph.nodes.length} nodos/nodes → ${path.join(project.outDir, 'MAP.md')}`);
}

// Deja el proyecto listo para Claude aunque no tenga el plugin instalado.
// Prepares the project for Claude even without the plugin installed.
function init(args) {
  const root = path.resolve(args.folder);
  const configFile = path.join(root, 'soulgraph.config.json');
  if (!fs.existsSync(configFile)) {
    fs.writeFileSync(configFile, `${JSON.stringify({ port: 7777, ignore: [] }, null, 2)}\n`);
    console.log(`[soulgraph] creado / created ${configFile}`);
  }

  const claudeFile = path.join(root, 'CLAUDE.md');
  const current = fs.existsSync(claudeFile) ? fs.readFileSync(claudeFile, 'utf8') : '';
  if (!current.includes('<!-- soulgraph -->')) {
    const note = [
      '',
      '<!-- soulgraph -->',
      '## SoulGraph',
      '',
      'Before searching or opening files, read `.soulgraph/MAP.md`: it lists every file, Roblox Studio script,',
      'function, require and who uses what. Open only the files you need. Studio scripts are mirrored read-only',
      `in \`.soulgraph/studio/\`. If it looks stale: \`node "${path.join(__dirname, 'soulgraph.js')}" build .\``,
      '',
      'Antes de buscar o abrir archivos, lee `.soulgraph/MAP.md`: tiene todo el proyecto resumido.',
      '',
    ].join('\n');
    fs.writeFileSync(claudeFile, current + note);
    console.log(`[soulgraph] aviso añadido a / note added to ${claudeFile}`);
  }
  build(args);
}

function openBrowser(url) {
  const [cmd, cmdArgs] = process.platform === 'win32'
    ? ['explorer.exe', [url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {
    // Sin navegador no pasa nada: la URL ya está en la consola.
    // No browser is fine: the URL is already printed.
  }
}

const args = parseArgs(process.argv.slice(2));
if (args.command === 'help') console.log(HELP);
else if (args.command === 'version') console.log(pkg.version);
else if (!fs.existsSync(args.folder)) console.error(`[soulgraph] No existe la carpeta / Folder not found: ${args.folder}`);
else ({ serve, build, init })[args.command](args);
