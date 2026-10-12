<p align="center"><img src="docs/banner.png" alt="SoulGraph by Vyxode" width="100%"></p>

<p align="center">
  <b>A live map of your project, for you and for Claude.</b><br>
  <b>Un mapa en vivo de tu proyecto, para ti y para Claude.</b>
</p>

<p align="center">
  <a href="#english">English</a> · <a href="#español">Español</a>
</p>

![SoulGraph panel](docs/screenshot.png)

---

# English

## What is SoulGraph?

SoulGraph turns your project into a live 3D graph that looks like a neural network. The project here means
the files on your disk **and** the Roblox Studio places you have open. Every script, module, function,
RemoteEvent, folder and model is a neuron, and every `require`, function call and event is a synapse.
When something changes, it lights up.

It also gives **Claude** the same map, so Claude understands your whole project without opening files one
by one. It can find things, see who uses what, and edit your Studio scripts live.

## Features

- **3D panel on `localhost:7777`**, with glowing neurons and impulses along requires and events.
- **Live Roblox Studio sync**: services, folders, models, scripts, attributes and tags, across several places at once.
- **Real code editor**:
  - Luau highlighting, line numbers and search/replace.
  - Saves to disk or straight into Studio, undoable with Ctrl+Z.
  - Never overwrites a change someone else made while you were editing.
- **Search** by name or **inside the code**, jumping straight to the line.
- **Function graph**: which script calls `Module.function`.
- **RemoteEvents**: who fires each event and who listens to it, client ↔ server.
- **Project health**: broken requires, circular dependencies, duplicate names, unused modules, and events with no sender or listener.
- **Firing neurons and recent activity**: whatever changes flashes, and you can filter to the last 30 minutes.
- **Readable at any size**:
  - Services gather together.
  - Hundreds of similar models collapse into one "N ×" node.
  - Functions appear when you open their module.
- **Full or light effects**: in full mode, a governor keeps it above ~30 FPS. Light mode is flat and fast on any computer.
- **Claude tools (MCP)** and a **Claude Code plugin**, plus a `MAP.md` that any AI can read.
- Spanish and English interface. Zero runtime dependencies, works offline.

## Requirements

- [Node.js 20 or newer](https://nodejs.org).
- Roblox Studio, only if you want the live game sync.
- No `npm install` needed.

## Installation

```bash
git clone https://github.com/vyxode/soulgraph.git
```

Or download the ZIP from GitHub (*Code → Download ZIP*) and unzip it anywhere, for example `D:\Tools\soulgraph`.

## How to use

### 1. Start the panel

```bash
node path/to/soulgraph/cli/soulgraph.js serve path/to/your/project
```

Your browser opens http://localhost:7777, and a `.soulgraph/` folder appears inside your project.

> **Windows tip:** create `Open_SoulGraph.bat` in your project folder so you can start it with a double click:
> ```bat
> @echo off
> node "D:\Tools\soulgraph\cli\soulgraph.js" serve "%~dp0."
> pause
> ```

### 2. Connect Roblox Studio

1. In Studio, open **Plugins → Plugins Folder** and copy `roblox/SoulGraph.plugin.lua` there.
2. Restart Studio and open your place.
3. The first time, Studio asks whether the plugin can connect to `localhost`. Click **Allow**.
4. The panel's top bar shows **Studio · *your place*** in green.

The **SoulGraph** button in the *Plugins* tab pauses or resumes the sync. You can open several places at once,
and each one becomes its own branch of the graph.

### 3. Connect Claude

Pick whichever matches how you use Claude:

**Claude Code** installs the plugin, which brings the skill and the tools. The tools start the panel on their own.

```text
/plugin marketplace add vyxode/soulgraph
/plugin install soulgraph@vyxode
```

**Claude desktop app:** open *Settings → Developer → Edit config*, add this inside `"mcpServers"`, save, and
quit and reopen Claude. Use forward slashes in Windows paths.

```json
"soulgraph": {
  "command": "node",
  "args": ["D:/Tools/soulgraph/cli/soulgraph.js", "mcp", "D:/path/to/your/project"]
}
```

**Any other AI, or no plugin:** run `node path/to/soulgraph/cli/soulgraph.js init path/to/project`. It adds a
note to the project's `CLAUDE.md` telling the AI to read `.soulgraph/MAP.md` first.

### 4. Use the panel

| To… | Do this |
|---|---|
| Move around | Left-drag to rotate, right-drag to pan, scroll to zoom. The ⛶ button recenters the view. |
| Open something | Click a node. The inspector opens on the right with its code, attributes and connections. |
| Edit code | Type in the editor, then press **Save** or `Ctrl+S`. Studio scripts change live. |
| Find by name | Type in the search box, or press `/`. `Enter` jumps to the best match. |
| Search the code | Switch the search to **Code**, then click a result to open it at that line. |
| Filter | Toggle sources, kinds and connection types in the left sidebar. `[` hides the sidebar. |
| See a model group | Click a "N ×" node to expand it. **Group the models again** folds it back. |
| Check problems | Open **Health** in the sidebar. Each issue takes you to its script. |
| See what changed | **Recent activity** lists the latest changes. **Only recent** filters the graph to them. |
| Names and effects | Use the bottom toolbar: **Names** (off / main / all) and **Effects** (full / light). |
| Open in Studio | In the inspector, **Open in Studio** selects the instance and opens scripts at your cursor's line. |

### 5. Ask Claude

With the tools connected, ask things like these:

- *"Which scripts fire the `Damage` RemoteEvent, and who listens to it?"*
- *"Where is `DayCycle.Apply` used? Rename it to `DayCycle.SetTime` everywhere."*
- *"Check the project health and fix the broken requires."*

| Tool | What it does |
|---|---|
| `soulgraph_overview` | Places, counts, health and every script. |
| `soulgraph_find` | Find by name, path or defined function. |
| `soulgraph_search_code` | Text search inside every script, returning `path:line`. |
| `soulgraph_node` | One node with its links and its source code. |
| `soulgraph_health` | Every health issue. |
| `soulgraph_edit` | Replace exact text in a script or file, live in Studio. |
| `soulgraph_open_in_studio` | Select an instance in Studio, or open a script at a line. |

## Commands

```text
soulgraph [serve] [folder] [--port 7777] [--no-open]   Live panel + map
soulgraph build [folder]                               Regenerate .soulgraph/ once
soulgraph init [folder]                                Config + note in CLAUDE.md
soulgraph mcp [folder]                                 MCP server for Claude (starts the panel if needed)
```

## What it creates in your project

```text
your-project/
├─ soulgraph.config.json      optional settings
└─ .soulgraph/
   ├─ MAP.md                  everything in one read (made for AIs)
   ├─ graph.json              every node and link, one per line
   ├─ studio.json             last Studio snapshot
   └─ studio/<place>/         read-only copy of the Studio scripts
```

Add `.soulgraph/` to your `.gitignore` if you don't want to commit it.

## Configuration

`soulgraph.config.json` is optional, and so is every field in it:

```json
{
  "port": 7777,
  "ignore": ["Builds", "Temp"],
  "maxTextBytes": 1048576,
  "sampleBytes": 65536
}
```

If you change the port, also change `SERVER_URL` at the top of the Studio plugin.

## Troubleshooting

| Problem | Fix |
|---|---|
| "Port 7777 is busy" | SoulGraph is already running, or something else uses the port. Use `--port 7780` and update `SERVER_URL` in the plugin. |
| Studio shows as disconnected | Check that the panel is running and that the **SoulGraph** button in Plugins is on. Then go to *Plugins → Manage Plugins → SoulGraph* and allow HTTP to `localhost`. |
| It runs slowly | Set **Effects → Light** in the bottom toolbar. |
| An update doesn't show | Reload with `Ctrl+F5`. |
| The map is out of date | `node cli/soulgraph.js build path/to/project`, or just keep the panel open. |

## For developers

```text
 disk ──► scanners/disk.js ─┐                          ┌─► MAP.md / graph.json / studio/  (Claude)
                            ├─► analyzers ─► graph.js ─┤
 Studio plugin ─► studio.js ┘   (per window)           ├─► server.js ─► SSE ─► panel      (you)
            ▲                                          └─► mcp.js ─► tools               (Claude)
            └──────── long-poll commands (edit, open, props) ◄──┘
```

- **Add a language:** create `src/analyzers/<lang>.js` exporting `{ name, test(info), analyze(text, info) }`, which returns `symbols`, `imports`, `calls`, `sends`, `listens` and `refs`, and register it in `src/analyzers/index.js`.
- **Add a file type:** add its extension to `src/kinds.js` and a color to `public/util.js`.
- **Add a live source** (Blender, Unity…): follow `src/studio.js`.
- **Add a Claude tool:** add an entry to `TOOLS` in `src/mcp.js`.
- **Add a panel language:** copy a block in `public/i18n.js`.
- **Rebuild the bundled libraries:** `npm install && npm run build:vendor`.
- **Run the tests:** `npm test`.

## Security

- The server only listens on `127.0.0.1`, and it rejects foreign `Host` or `Origin` headers, so websites can't reach your files.
- Paths can never point outside the project folder.
- A save is refused if the file changed since you opened it; then you choose which version wins.

---

# Español

## ¿Qué es SoulGraph?

SoulGraph convierte tu proyecto en un grafo 3D en vivo que parece una red neuronal. Aquí el proyecto son
los archivos del disco **y** los lugares de Roblox Studio que tengas abiertos. Cada script, módulo, función,
RemoteEvent, carpeta y modelo es una neurona, y cada `require`, llamada a función y evento es una sinapsis.
Cuando algo cambia, se enciende.

Además le da a **Claude** el mismo mapa, para que entienda todo tu proyecto sin abrir archivo por archivo.
Puede encontrar cosas, ver quién usa qué y editar tus scripts de Studio en vivo.

## Funciones

- **Panel 3D en `localhost:7777`**, con neuronas que brillan e impulsos por los `require` y los eventos.
- **Sincronización en vivo con Roblox Studio**: servicios, carpetas, modelos, scripts, atributos y etiquetas, con varios lugares a la vez.
- **Editor de código de verdad**:
  - Colores de Luau, números de línea y buscar/reemplazar.
  - Guarda en disco o directamente en Studio, y se deshace con Ctrl+Z.
  - Nunca pisa un cambio que otro haya hecho mientras editabas.
- **Búsqueda** por nombre o **dentro del código**, saltando directo a la línea.
- **Grafo de funciones**: qué script llama a `Modulo.funcion`.
- **RemoteEvents**: quién dispara cada evento y quién lo escucha, cliente ↔ servidor.
- **Salud del proyecto**: `require` rotos, dependencias circulares, nombres repetidos, módulos sin usar y eventos sin emisor u oyente.
- **Neuronas que se disparan y actividad reciente**: lo que cambia destella, y puedes filtrar los últimos 30 minutos.
- **Legible aunque sea enorme**:
  - Los servicios se agrupan.
  - Cientos de modelos parecidos se juntan en un nodo "N ×".
  - Las funciones aparecen al abrir su módulo.
- **Efectos completos o ligeros**: con efectos completos, un regulador lo mantiene por encima de ~30 FPS. El modo ligero es plano y rápido en cualquier ordenador.
- **Herramientas para Claude (MCP)** y **plugin de Claude Code**, además de un `MAP.md` que puede leer cualquier IA.
- Interfaz en español e inglés. Sin dependencias para usarlo y funciona sin internet.

## Requisitos

- [Node.js 20 o superior](https://nodejs.org).
- Roblox Studio, solo si quieres la sincronización en vivo con el juego.
- No hace falta `npm install`.

## Instalación

```bash
git clone https://github.com/vyxode/soulgraph.git
```

O descarga el ZIP desde GitHub (*Code → Download ZIP*) y descomprímelo donde quieras, por ejemplo en `D:\Herramientas\soulgraph`.

## Cómo se usa

### 1. Abre el panel

```bash
node ruta/a/soulgraph/cli/soulgraph.js serve ruta/a/tu/proyecto
```

El navegador abre http://localhost:7777 y aparece una carpeta `.soulgraph/` dentro de tu proyecto.

> **Truco para Windows:** crea `Abrir_SoulGraph.bat` en la carpeta del proyecto para abrirlo con doble clic:
> ```bat
> @echo off
> node "D:\Herramientas\soulgraph\cli\soulgraph.js" serve "%~dp0."
> pause
> ```

### 2. Conecta Roblox Studio

1. En Studio, abre **Plugins → Plugins Folder** y copia ahí `roblox/SoulGraph.plugin.lua`.
2. Reinicia Studio y abre tu lugar.
3. La primera vez, Studio pregunta si el plugin puede conectarse a `localhost`. Pulsa **Permitir**.
4. En la barra superior del panel sale **Studio · *tu lugar*** en verde.

El botón **SoulGraph** de la pestaña *Plugins* pausa o reanuda la sincronización. Puedes tener varios lugares
abiertos a la vez, y cada uno será una rama propia del grafo.

### 3. Conecta Claude

Elige según cómo uses Claude:

**Claude Code** instala el plugin, que trae la skill y las herramientas. Las herramientas encienden el panel solas.

```text
/plugin marketplace add vyxode/soulgraph
/plugin install soulgraph@vyxode
```

**App de escritorio de Claude:** abre *Ajustes → Desarrollador → Editar configuración*, añade esto dentro de
`"mcpServers"`, guarda, y cierra Claude del todo y vuelve a abrirlo. En Windows usa barras `/` en las rutas.

```json
"soulgraph": {
  "command": "node",
  "args": ["D:/Herramientas/soulgraph/cli/soulgraph.js", "mcp", "D:/ruta/a/tu/proyecto"]
}
```

**Otra IA, o sin plugin:** ejecuta `node ruta/a/soulgraph/cli/soulgraph.js init ruta/al/proyecto`. Añade un aviso
al `CLAUDE.md` del proyecto para que la IA lea primero `.soulgraph/MAP.md`.

### 4. Usa el panel

| Para… | Haz esto |
|---|---|
| Moverte | Arrastra con el botón izquierdo para girar, con el derecho para desplazar, y usa la rueda para el zoom. El botón ⛶ centra la vista. |
| Abrir algo | Pulsa un nodo. A la derecha se abre el inspector con su código, atributos y conexiones. |
| Editar código | Escribe en el editor y pulsa **Guardar** o `Ctrl+S`. Los scripts de Studio cambian en vivo. |
| Buscar por nombre | Escribe en el buscador o pulsa `/`. `Enter` salta al mejor resultado. |
| Buscar en el código | Cambia el buscador a **Código** y pulsa un resultado para abrirlo en esa línea. |
| Filtrar | Activa o desactiva fuentes, tipos y conexiones en la barra lateral. `[` la esconde. |
| Ver un grupo de modelos | Pulsa un nodo "N ×" para desplegarlo. **Volver a agrupar los modelos** lo pliega. |
| Revisar problemas | Abre **Salud** en la barra lateral. Cada aviso te lleva a su script. |
| Ver qué ha cambiado | **Actividad reciente** muestra los últimos cambios. **Solo lo reciente** deja solo eso en el grafo. |
| Nombres y efectos | En la barra de abajo: **Nombres** (no / principales / todos) y **Efectos** (completos / ligeros). |
| Abrir en Studio | En el inspector, **Abrir en Studio** selecciona la instancia y abre los scripts en la línea de tu cursor. |

### 5. Pídeselo a Claude

Con las herramientas conectadas, puedes preguntar cosas como estas:

- *"¿Qué scripts disparan el RemoteEvent `Dano` y quién lo escucha?"*
- *"¿Dónde se usa `CicloDiaNoche.Aplicar`? Cámbialo por `CicloDiaNoche.PonerHora` en todos lados."*
- *"Revisa la salud del proyecto y arregla los `require` rotos."*

| Herramienta | Qué hace |
|---|---|
| `soulgraph_overview` | Lugares, cifras, salud y todos los scripts. |
| `soulgraph_find` | Buscar por nombre, ruta o función definida. |
| `soulgraph_search_code` | Buscar texto en todo el código, con `ruta:línea`. |
| `soulgraph_node` | Un nodo con sus conexiones y su código. |
| `soulgraph_health` | Todos los avisos de salud. |
| `soulgraph_edit` | Reemplazar texto exacto en un script o archivo, en vivo en Studio. |
| `soulgraph_open_in_studio` | Seleccionar una instancia en Studio o abrir un script en una línea. |

## Comandos

```text
soulgraph [serve] [carpeta] [--port 7777] [--no-open]  Panel en vivo + mapa
soulgraph build [carpeta]                              Regenera .soulgraph/ una vez
soulgraph init [carpeta]                               Config + aviso en CLAUDE.md
soulgraph mcp [carpeta]                                Servidor MCP para Claude (enciende el panel si hace falta)
```

## Qué crea en tu proyecto

```text
tu-proyecto/
├─ soulgraph.config.json      ajustes opcionales
└─ .soulgraph/
   ├─ MAP.md                  todo en una lectura (pensado para IAs)
   ├─ graph.json              cada nodo y enlace, uno por línea
   ├─ studio.json             última foto de Studio
   └─ studio/<lugar>/         copia de solo lectura de los scripts de Studio
```

Añade `.soulgraph/` a tu `.gitignore` si no quieres subirlo.

## Configuración

`soulgraph.config.json` es opcional, igual que cada campo:

```json
{
  "port": 7777,
  "ignore": ["Builds", "Temp"],
  "maxTextBytes": 1048576,
  "sampleBytes": 65536
}
```

Si cambias el puerto, cambia también `SERVER_URL` al principio del plugin de Studio.

## Solución de problemas

| Problema | Solución |
|---|---|
| "El puerto 7777 está ocupado" | SoulGraph ya está abierto, o hay otro programa en ese puerto. Usa `--port 7780` y cambia `SERVER_URL` en el plugin. |
| Studio sale desconectado | Comprueba que el panel está abierto y que el botón **SoulGraph** de Plugins está activo. Después, en *Plugins → Manage Plugins → SoulGraph*, permite HTTP a `localhost`. |
| Va lento | Pon **Efectos → Ligeros** en la barra de abajo. |
| No se ve una actualización | Recarga con `Ctrl+F5`. |
| El mapa está desactualizado | `node cli/soulgraph.js build ruta/al/proyecto`, o simplemente deja el panel abierto. |

## Para desarrolladores

- **Añadir un lenguaje:** crea `src/analyzers/<lenguaje>.js` exportando `{ name, test(info), analyze(text, info) }`, que devuelve `symbols`, `imports`, `calls`, `sends`, `listens` y `refs`, y regístralo en `src/analyzers/index.js`.
- **Añadir un tipo de archivo:** añade su extensión en `src/kinds.js` y un color en `public/util.js`.
- **Añadir una fuente en vivo** (Blender, Unity…): sigue el modelo de `src/studio.js`.
- **Añadir una herramienta para Claude:** añade una entrada a `TOOLS` en `src/mcp.js`.
- **Añadir un idioma al panel:** copia un bloque en `public/i18n.js`.
- **Reconstruir las librerías empaquetadas:** `npm install && npm run build:vendor`.
- **Ejecutar las pruebas:** `npm test`.

## Seguridad

- El servidor solo escucha en `127.0.0.1` y rechaza cabeceras `Host` u `Origin` ajenas, así que ninguna web puede tocar tus archivos.
- Las rutas nunca pueden salir de la carpeta del proyecto.
- Si un archivo cambió desde que lo abriste, no se guarda encima; eliges tú qué versión gana.

---

## License / Licencia

[MIT](LICENSE) © Vyxode
