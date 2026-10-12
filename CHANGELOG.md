# Changelog

## 0.3.1 — performance

- **About 6× fewer draw calls with full effects.** On a real 1,400-node project, draw calls per frame went from 2,827 to 462 and triangles from 424k to 107k.
  - Halos are a single point cloud with a custom shader, instead of one sprite per node.
  - All links are drawn as two line objects, with curves computed in JS, instead of one object per link.
  - Spheres are opaque, so they're no longer sorted every frame.
  - Impulses only run on the links of what you're looking at, plus about 60 in the background.
  - Bloom is computed at half resolution.
- **FPS governor:** in full mode it measures FPS every second. Under ~33 FPS it lowers the internal resolution step by step and finally turns off the bloom. With headroom it goes back up. Only if even that can't reach ~30 FPS does it switch to light mode and tell you.

## 0.3.0

- **Loading screen:** the SoulGraph star draws itself, ignites and the name appears with a glitch while the graph is laid out.
- **Easier to read:**
  - each service or top folder gathers into its own neighbourhood
  - hundreds of similar models collapse into one "N × name" node that expands on click
  - functions only show up when their module is open
  - names no longer overlap
- **More neural:** neurons with halos, curved synapses, subtle impulses, distant star dust and depth fog.
- **Interface:**
  - kind icons everywhere
  - clickable path breadcrumb
  - floating view toolbar
  - collapsible filters (`[`)
  - sentence-case headings
  - selection ring
  - smoother camera
- **Effects: Full / Light.**
  - Light mode is flat and fast: no bloom, halos, fog or particles, and lower geometry.
  - It's picked automatically on modest computers, or when the first seconds run below ~26 FPS, and you can always switch it in the toolbar.
  - The animation pauses while the tab is hidden.

## 0.2.0

- **Claude tools (MCP):** `soulgraph mcp` with overview, find, code search, node, health, edit and open-in-Studio.
  It starts the panel by itself when needed. The plugin declares it in `plugin.json`.
- **Function graph:** public module functions are nodes, with `calls` links from the scripts that use them.
- **RemoteEvents / BindableEvents:** `signal` links from the script that fires to the event to the script that listens.
- **Health:** broken requires, circular requires, duplicate module names, possibly unused modules, events with no sender or listener.
- **Several Studio windows at once:** each place is its own branch, and mirrors go to `.soulgraph/studio/<place>/`.
- **Panel:**
  - CodeMirror editor (Luau highlighting, line numbers, search/replace, wrap)
  - search inside the code
  - firing neurons and recent activity
  - name labels
  - health section
  - Vyxode glitch branding
- `bin/` renamed to `cli/` so claude.ai and Cowork can install the plugin.

## 0.1.0

- First release: disk and Roblox Studio graph, `MAP.md` for Claude, 3D panel with live editing, and the Studio plugin.
