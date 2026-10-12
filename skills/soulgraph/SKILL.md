---
name: soulgraph
description: Use in any project with a .soulgraph/ folder or soulgraph.config.json, and whenever you need to find where something lives, what uses what, which script fires an event, or get an overview of a codebase or Roblox place. Use the SoulGraph tools or map instead of opening files one by one. Also use to start the live SoulGraph panel.
---

# SoulGraph

SoulGraph keeps a live graph of the project. It covers the files on disk **and** every open Roblox Studio
place: scripts, modules, public functions, RemoteEvents and BindableEvents, folders, models, attributes and
tags. It also tracks who requires, calls, fires or listens to what.

## With the SoulGraph tools (preferred)

If the `soulgraph_*` tools are available:

1. `soulgraph_overview` first. It lists the places, the counts, the health issues and every script with its path.
2. To locate things, use `soulgraph_find` (by name, path or function) and `soulgraph_search_code`
   (text inside the code, returning `path:line`).
3. `soulgraph_node` gives you one item with its connections and source. Read only what you need.
4. To change code, use `soulgraph_edit` with an exact, unique `old_text` and the `new_text`. The change reaches
   Studio live and the user can undo it there with Ctrl+Z. If it fails because the text changed, read the node again.
5. `soulgraph_health` before refactors, and `soulgraph_open_in_studio` to show the user a spot.

## Without the tools

1. Read `.soulgraph/MAP.md` first. In one read it gives you:
   - every script with its path, kind (server / client / module), line count, the functions it defines,
     what it requires and calls, which events it fires or listens to, and who uses it;
   - the events and who fires and hears each one;
   - the health issues;
   - the Studio structure and the disk tree.
2. Open **only** the files you need.
   - Studio scripts are mirrored read-only in `.soulgraph/studio/<place>/`, with Rojo-style names
     (`.server.lua`, `.client.lua`, and `.lua` for modules).
   - Editing a mirror does nothing. Change Studio code with the tools above, the Studio tools you have,
     or the panel.
3. For exact relationships, grep `.soulgraph/graph.json`, which has one node or link per line.
   Link types are `contains`, `requires`, `calls`, `signal` and `references`.

## If the map is missing or stale

The map only refreshes while SoulGraph is running, as the panel or the MCP server. Rebuild it with:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/soulgraph.js" build .
```

Studio data only refreshes while Studio is open with the SoulGraph plugin enabled. The "Roblox Studio"
line at the top of the map says whether each place is live.

## Live panel

When the user wants to see or explore the project:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/soulgraph.js" serve .
```

Then point them to http://localhost:7777. It's a 3D graph they can filter, search, open and edit in real time.
The MCP tools already start it, so it may be running.

## Notes

- Don't edit anything inside `.soulgraph/` by hand; it's regenerated automatically.
- Requires Node.js 20+.
