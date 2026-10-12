// Textos del panel en español e inglés.
// Panel texts in Spanish and English.
//
// Para añadir un idioma: copia el bloque `en`, tradúcelo y añádelo a LANGS.
// To add a language: copy the `en` block, translate it and add it to LANGS.

const LANGS = {
  es: {
    search: 'Buscar nombre, ruta o función…',
    matches: (n) => `${n} coincidencias · Enter para ir`,
    sources: 'Fuentes',
    disk: 'Disco',
    studio: 'Studio',
    kinds: 'Tipos',
    links: 'Conexiones',
    contains: 'Contiene',
    requires: 'Usa (require)',
    references: 'Menciona',
    live: 'En vivo',
    offline: 'Sin conexión',
    studioOff: 'Studio desconectado',
    studioHint: 'Abre Studio con el plugin SoulGraph activado',
    nodes: 'nodos',
    linksCount: 'enlaces',
    openInStudio: 'Abrir en Studio',
    copyPath: 'Copiar ruta',
    copied: 'Ruta copiada',
    save: 'Guardar',
    saved: 'Guardado',
    saving: 'Guardando…',
    unsaved: 'Sin guardar',
    reload: 'Recargar',
    overwrite: 'Sobrescribir',
    changedOutside: 'Ha cambiado fuera mientras editabas.',
    notEditable: 'Este archivo no se puede editar como texto.',
    tooBig: 'Demasiado grande para editar aquí.',
    name: 'Nombre',
    attributes: 'Atributos',
    tags: 'Etiquetas',
    applyChanges: 'Aplicar en Studio',
    defines: 'Define',
    uses: 'Usa',
    usedBy: 'Lo usan',
    mentions: 'Menciona',
    mentionedBy: 'Mencionado por',
    inside: 'Dentro de',
    children: 'Contiene',
    lines: 'líneas',
    close: 'Cerrar',
    resetView: 'Centrar vista',
    needsStudio: 'Studio no está conectado',
    error: 'Error',
    kind: {
      root: 'Proyecto', folder: 'Carpeta', code: 'Código', doc: 'Documento', data: 'Datos', image: 'Imagen',
      mesh: 'Modelo 3D', place: 'Lugar Roblox', audio: 'Audio', other: 'Otro', service: 'Servicio',
      model: 'Model', server: 'Script servidor', client: 'Script cliente', module: 'ModuleScript', instance: 'Instancia',
    },
  },
  en: {
    search: 'Search name, path or function…',
    matches: (n) => `${n} matches · Enter to jump`,
    sources: 'Sources',
    disk: 'Disk',
    studio: 'Studio',
    kinds: 'Kinds',
    links: 'Connections',
    contains: 'Contains',
    requires: 'Uses (require)',
    references: 'Mentions',
    live: 'Live',
    offline: 'Offline',
    studioOff: 'Studio disconnected',
    studioHint: 'Open Studio with the SoulGraph plugin enabled',
    nodes: 'nodes',
    linksCount: 'links',
    openInStudio: 'Open in Studio',
    copyPath: 'Copy path',
    copied: 'Path copied',
    save: 'Save',
    saved: 'Saved',
    saving: 'Saving…',
    unsaved: 'Unsaved',
    reload: 'Reload',
    overwrite: 'Overwrite',
    changedOutside: 'It changed outside while you were editing.',
    notEditable: 'This file can’t be edited as text.',
    tooBig: 'Too big to edit here.',
    name: 'Name',
    attributes: 'Attributes',
    tags: 'Tags',
    applyChanges: 'Apply in Studio',
    defines: 'Defines',
    uses: 'Uses',
    usedBy: 'Used by',
    mentions: 'Mentions',
    mentionedBy: 'Mentioned by',
    inside: 'Inside',
    children: 'Contains',
    lines: 'lines',
    close: 'Close',
    resetView: 'Reset view',
    needsStudio: 'Studio is not connected',
    error: 'Error',
    kind: {
      root: 'Project', folder: 'Folder', code: 'Code', doc: 'Document', data: 'Data', image: 'Image',
      mesh: '3D model', place: 'Roblox place', audio: 'Audio', other: 'Other', service: 'Service',
      model: 'Model', server: 'Server script', client: 'Client script', module: 'ModuleScript', instance: 'Instance',
    },
  },
};

// Idioma guardado o el del navegador / Saved language or the browser's
let currentLang = (() => {
  try {
    const saved = localStorage.getItem('soulgraph.lang');
    if (saved && LANGS[saved]) return saved;
  } catch {
    // almacenamiento bloqueado / storage blocked
  }
  return navigator.language && navigator.language.startsWith('es') ? 'es' : 'en';
})();

export function t(key, ...args) {
  const value = LANGS[currentLang][key] ?? LANGS.en[key] ?? key;
  return typeof value === 'function' ? value(...args) : value;
}

export function kindLabel(kind) {
  return LANGS[currentLang].kind[kind] || kind;
}

export function getLang() {
  return currentLang;
}

export function toggleLang() {
  currentLang = currentLang === 'es' ? 'en' : 'es';
  try {
    localStorage.setItem('soulgraph.lang', currentLang);
  } catch {
    // sin almacenamiento, solo dura esta sesión / no storage, lasts this session only
  }
  return currentLang;
}
