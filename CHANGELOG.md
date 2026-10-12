# Changelog

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
