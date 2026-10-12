# ✦ SoulGraph

**A live map of your project, for you and for Claude.**
**Un mapa en vivo de tu proyecto, para ti y para Claude.**

SoulGraph turns a project — files on disk **and** a live Roblox Studio place — into a 3D neural-network
graph you can filter, open and edit in real time, and into a single `MAP.md` that lets Claude understand
the whole project without opening files one by one.

SoulGraph convierte un proyecto — archivos del disco **y** un lugar de Roblox Studio en vivo — en un grafo 3D
tipo red neuronal que puedes filtrar, abrir y editar en tiempo real, y en un único `MAP.md` con el que Claude
entiende todo el proyecto sin abrir archivo por archivo.

![SoulGraph panel](docs/screenshot.png)

---

## What it does / Qué hace

| | English | Español |
|---|---|---|
| 🧠 | **Claude plugin**: a skill that makes Claude read `.soulgraph/MAP.md` first and open only what it needs. | **Plugin para Claude**: una skill que hace que Claude lea `.soulgraph/MAP.md` primero y abra solo lo necesario. |
| 🌌 | **Panel on `localhost:7777`**: 3D graph with glow and "impulses" along `require` links. | **Panel en `localhost:7777`**: grafo 3D con brillo e "impulsos" por los `require`. |
| 🔎 | Filter by source, kind and link type; search names, paths and functions. | Filtra por fuente, tipo y conexión; busca nombres, rutas y funciones. |
| ✏️ | Edit text files and Studio scripts; rename instances and edit attributes. Conflict-safe. | Edita archivos de texto y scripts de Studio; renombra instancias y cambia atributos. Sin pisar cambios. |
| ⚡ | Real time: disk changes and Studio edits (even unsaved typing) show up instantly. | Tiempo real: los cambios del disco y de Studio (incluso lo que escribes sin guardar) aparecen al instante. |
| 🎮 | **Roblox Studio plugin**: syncs services, folders, models, scripts, attributes and tags. | **Plugin de Roblox Studio**: sincroniza servicios, carpetas, modelos, scripts, atributos y etiquetas. |

---

## Quick start

**Requirements:** [Node.js 20+](https://nodejs.org). No `npm install` needed.

```bash
git clone https://github.com/Vyxode/soulgraph.git
node soulgraph/bin/soulgraph.js serve path/to/your/project
```

The panel opens at http://localhost:7777 and `.soulgraph/` appears inside your project.

**Roblox Studio:** copy `roblox/SoulGraph.plugin.lua` into Studio's plugins folder
(*Plugins → Plugins Folder*), restart Studio and allow the localhost permission the first time.
A **SoulGraph** button in the Plugins tab turns sync on and off.

**Claude Code:**

```text
/plugin marketplace add Vyxode/soulgraph
/plugin install soulgraph@vyxode
```

No plugin? Run `node soulgraph/bin/soulgraph.js init path/to/project` — it adds a note to the project's
`CLAUDE.md` so any Claude session reads the map first.

## Inicio rápido

**Necesitas:** [Node.js 20+](https://nodejs.org). No hace falta `npm install`.

```bash
git clone https://github.com/Vyxode/soulgraph.git
node soulgraph/bin/soulgraph.js serve ruta/a/tu/proyecto
```

El panel se abre en http://localhost:7777 y aparece la carpeta `.soulgraph/` dentro de tu proyecto.

**Roblox Studio:** copia `roblox/SoulGraph.plugin.lua` a la carpeta de plugins de Studio
(*Plugins → Plugins Folder*), reinicia Studio y acepta el permiso de localhost la primera vez.
El botón **SoulGraph** de la pestaña Plugins activa o pausa la sincronización.

**Claude Code:** los dos comandos de arriba (`/plugin marketplace add` y `/plugin install`).
¿Sin plugin? `node soulgraph/bin/soulgraph.js init ruta/al/proyecto` añade un aviso al `CLAUDE.md` del proyecto.

---

## Commands / Comandos

```text
soulgraph [serve] [folder] [--port 7777] [--no-open]   Live panel + map / Panel en vivo + mapa
soulgraph build [folder]                               Regenerate .soulgraph/ once / Regenera una vez
soulgraph init [folder]                                Config + CLAUDE.md note / Config + aviso en CLAUDE.md
```

## What it writes / Qué genera

```text
your-project/
├─ soulgraph.config.json      optional settings / ajustes opcionales
└─ .soulgraph/
   ├─ MAP.md                  for Claude: everything in one read / para Claude: todo en una lectura
   ├─ graph.json              every node and link, one per line / cada nodo y enlace, uno por línea
   ├─ studio.json             last Studio snapshot / última foto de Studio
   └─ studio/                 read-only mirror of Studio scripts / copia de solo lectura de los scripts
```

## Configuration / Configuración

`soulgraph.config.json` (all optional / todo opcional):

```json
{
  "port": 7777,
  "ignore": ["Builds", "Temp"],
  "maxTextBytes": 1048576,
  "sampleBytes": 65536
}
```

If you change the port, change `SERVER_URL` at the top of the Studio plugin too.
Si cambias el puerto, cambia también `SERVER_URL` al principio del plugin de Studio.

---

## How it works / Cómo funciona

```text
 disk ──► scanners/disk.js ─┐                         ┌─► MAP.md / graph.json / studio/   (Claude)
                            ├─► analyzers ─► graph.js ┤
 Studio plugin ─► studio.js ┘                         └─► server.js ─► SSE ─► panel (you / tú)
            ▲                                                  │
            └──────── long-poll commands (edit, open, props) ◄─┘
```

| File | Role / Función |
|---|---|
| `src/scanners/disk.js` | Walks the folder, caches analysis by size+mtime. / Recorre la carpeta con caché. |
| `src/studio.js` | Studio bridge: tree, sources, command queue, mirror. / Puente con Studio. |
| `src/analyzers/` | One file per language; pluggable. / Un archivo por lenguaje, enchufable. |
| `src/graph.js` | Nodes + `contains` / `requires` / `references` links. / Nodos y enlaces. |
| `src/map-writer.js` | Writes `.soulgraph/`. / Escribe `.soulgraph/`. |
| `src/server.js` | HTTP API + Server-Sent Events, zero dependencies. / API + SSE sin dependencias. |
| `public/` | The panel (3d-force-graph + bloom, bundled offline). / El panel, empaquetado sin internet. |
| `roblox/` | Studio plugin. / Plugin de Studio. |
| `skills/soulgraph/` | The Claude skill. / La skill de Claude. |

## Extending / Ampliarlo

- **New language / Nuevo lenguaje:** add `src/analyzers/<lang>.js` exporting
  `{ name, test(info), analyze(text, info) → { symbols, imports, refs } }` and register it in
  `src/analyzers/index.js`. Imports are linked to modules by name automatically.
- **New file type / Nuevo tipo de archivo:** add its extension to `src/kinds.js` and a color in `public/app.js`.
- **New live source / Nueva fuente en vivo** (Blender, Unity…): copy the pattern of `src/studio.js`
  — accept a tree + sources over HTTP and feed `buildGraph`.
- **New panel language / Nuevo idioma del panel:** copy a block in `public/i18n.js`.
- **Panel libraries / Librerías del panel:** `npm install && npm run build:vendor` rebuilds `public/vendor/graph-bundle.js`.

Run the tests / Ejecuta las pruebas: `npm test`.

## Security / Seguridad

- The server only listens on `127.0.0.1`. / Solo escucha en `127.0.0.1`.
- Requests with a foreign `Host` or `Origin` are rejected, so websites can't touch your files.
  / Se rechazan `Host` u `Origin` ajenos: ninguna web puede tocar tus archivos.
- File ids can never resolve outside the project folder. / Las rutas nunca salen de la carpeta del proyecto.
- Saves check the version you started from; if it changed meanwhile, you choose what wins.
  / Al guardar se comprueba la versión de partida; si cambió, eliges qué versión gana.

## License / Licencia

[MIT](LICENSE) © Vyxode
