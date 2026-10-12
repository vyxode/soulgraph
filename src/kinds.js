'use strict';
// Tipos de nodo según la extensión del archivo.
// Node kinds by file extension.
//
// Para soportar un formato nuevo basta con añadir su extensión aquí.
// To support a new format, just add its extension here.

const KIND_BY_EXT = {};
const groups = {
  code: ['lua', 'luau', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'cs', 'c', 'h', 'cpp', 'hpp', 'java', 'go', 'rs', 'gd', 'sh', 'bat', 'ps1', 'html', 'css'],
  doc: ['md', 'txt', 'rst'],
  data: ['json', 'toml', 'yaml', 'yml', 'csv', 'xml', 'ini'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'tga', 'bmp', 'svg'],
  mesh: ['obj', 'fbx', 'mtl', 'glb', 'gltf', 'blend', 'rbxm', 'rbxmx', 'dae'],
  place: ['rbxl', 'rbxlx'],
  audio: ['mp3', 'ogg', 'wav', 'flac'],
};
for (const [kind, exts] of Object.entries(groups)) {
  for (const ext of exts) KIND_BY_EXT[ext] = kind;
}

// Formatos que son texto aunque no sean "código" (se pueden leer y analizar).
// Formats that are plain text even if they aren't "code" (readable and analysable).
const TEXT_EXTS = new Set([
  ...groups.code, ...groups.doc, ...groups.data,
  'svg', 'obj', 'mtl', 'gltf', 'rbxmx', 'rbxlx', 'dae',
]);

function extOf(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function kindOfFile(name) {
  return KIND_BY_EXT[extOf(name)] || 'other';
}

function isTextFile(name) {
  return TEXT_EXTS.has(extOf(name));
}

// Clases de Roblox Studio → tipo de nodo.
// Roblox Studio classes → node kind.
function kindOfInstance(node) {
  if (!node.parent) return 'service';
  switch (node.class) {
    case 'Script': return node.runContext === 'Client' ? 'client' : 'server';
    case 'LocalScript': return 'client';
    case 'ModuleScript': return 'module';
    case 'Folder': return 'folder';
    case 'Model': case 'Actor': return 'model';
    default: return 'instance';
  }
}

module.exports = { extOf, kindOfFile, isTextFile, kindOfInstance };
