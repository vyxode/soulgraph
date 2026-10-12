# Changelog

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
