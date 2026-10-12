// Textos del panel en español e inglés.
// Panel texts in Spanish and English.
//
// Para añadir un idioma: copia el bloque `en`, tradúcelo y añádelo a LANGS.
// To add a language: copy the `en` block, translate it and add it to LANGS.

const LANGS = {
  es: {
    search: 'Buscar nombre, ruta o función…',
    searchCode: 'Buscar texto en el código…',
    modeNames: 'Nombres',
    modeCode: 'Código',
    matches: (n) => `${n} coincidencias · Enter para ir`,
    codeMatches: (shown, total) => (total > shown ? `${shown} de ${total} líneas` : `${total} líneas`),
    noResults: 'Sin resultados',
    sources: 'Fuentes',
    disk: 'Disco',
    studio: 'Studio',
    kinds: 'Tipos',
    links: 'Conexiones',
    contains: 'Contiene',
    requires: 'Usa (require)',
    calls: 'Llama a funciones',
    signal: 'Eventos remotos',
    references: 'Menciona',
    recent: 'Actividad reciente',
    onlyRecent: 'Solo lo reciente (30 min)',
    nothingRecent: 'Aún no ha cambiado nada.',
    ago: (min) => (min < 1 ? 'ahora' : `hace ${min} min`),
    labels: 'Nombres en el grafo',
    labelsOff: 'No',
    labelsMain: 'Principales',
    labelsAll: 'Todos',
    health: 'Salud',
    healthy: 'Todo en orden.',
    issue: {
      'broken-require': 'require roto',
      'duplicate-name': 'Nombre repetido',
      'unused-module': 'Módulo sin usar',
      'event-no-listener': 'Evento sin oyente',
      'event-no-sender': 'Nadie lo dispara',
      cycle: 'Dependencia circular',
    },
    live: 'En vivo',
    offline: 'Sin conexión',
    studioOff: 'Studio desconectado',
    studioPlaces: (n) => `Studio · ${n} lugares`,
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
    discard: '¿Descartar los cambios sin guardar?',
    notEditable: 'Este archivo no se puede editar como texto.',
    name: 'Nombre',
    attributes: 'Atributos',
    tags: 'Etiquetas',
    applyChanges: 'Aplicar en Studio',
    defines: 'Define',
    uses: 'Usa',
    usedBy: 'Lo usan',
    callsTo: 'Llama a',
    calledBy: 'La llaman',
    fires: 'Dispara',
    listensTo: 'Escucha',
    firedBy: 'Lo disparan',
    heardBy: 'Lo escuchan',
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
      root: 'Proyecto', game: 'Lugar de Studio', folder: 'Carpeta', code: 'Código', doc: 'Documento', data: 'Datos',
      image: 'Imagen', mesh: 'Modelo 3D', place: 'Archivo .rbxl', audio: 'Audio', other: 'Otro', service: 'Servicio',
      model: 'Model', server: 'Script servidor', client: 'Script cliente', module: 'ModuleScript', instance: 'Instancia',
      remote: 'Evento', function: 'Función',
    },
  },
  en: {
    search: 'Search name, path or function…',
    searchCode: 'Search text in the code…',
    modeNames: 'Names',
    modeCode: 'Code',
    matches: (n) => `${n} matches · Enter to jump`,
    codeMatches: (shown, total) => (total > shown ? `${shown} of ${total} lines` : `${total} lines`),
    noResults: 'No results',
    sources: 'Sources',
    disk: 'Disk',
    studio: 'Studio',
    kinds: 'Kinds',
    links: 'Connections',
    contains: 'Contains',
    requires: 'Uses (require)',
    calls: 'Calls functions',
    signal: 'Remote events',
    references: 'Mentions',
    recent: 'Recent activity',
    onlyRecent: 'Only recent (30 min)',
    nothingRecent: 'Nothing has changed yet.',
    ago: (min) => (min < 1 ? 'now' : `${min} min ago`),
    labels: 'Names in the graph',
    labelsOff: 'Off',
    labelsMain: 'Main',
    labelsAll: 'All',
    health: 'Health',
    healthy: 'All good.',
    issue: {
      'broken-require': 'Broken require',
      'duplicate-name': 'Duplicate name',
      'unused-module': 'Unused module',
      'event-no-listener': 'Event with no listener',
      'event-no-sender': 'Nobody fires it',
      cycle: 'Circular dependency',
    },
    live: 'Live',
    offline: 'Offline',
    studioOff: 'Studio disconnected',
    studioPlaces: (n) => `Studio · ${n} places`,
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
    discard: 'Discard unsaved changes?',
    notEditable: 'This file can’t be edited as text.',
    name: 'Name',
    attributes: 'Attributes',
    tags: 'Tags',
    applyChanges: 'Apply in Studio',
    defines: 'Defines',
    uses: 'Uses',
    usedBy: 'Used by',
    callsTo: 'Calls',
    calledBy: 'Called by',
    fires: 'Fires',
    listensTo: 'Listens to',
    firedBy: 'Fired by',
    heardBy: 'Heard by',
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
      root: 'Project', game: 'Studio place', folder: 'Folder', code: 'Code', doc: 'Document', data: 'Data',
      image: 'Image', mesh: '3D model', place: '.rbxl file', audio: 'Audio', other: 'Other', service: 'Service',
      model: 'Model', server: 'Server script', client: 'Client script', module: 'ModuleScript', instance: 'Instance',
      remote: 'Event', function: 'Function',
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

export function issueLabel(type) {
  return LANGS[currentLang].issue[type] || type;
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
