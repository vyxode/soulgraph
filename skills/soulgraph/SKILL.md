---
name: soulgraph
description: Use in any project with a .soulgraph/ folder or soulgraph.config.json, and whenever you need to find where something lives, what uses what, or get an overview of a codebase or Roblox place. Read the SoulGraph map instead of opening files one by one. Also use to start the live SoulGraph panel.
---

# SoulGraph

SoulGraph keeps a live map of the project — files on disk **and** the Roblox Studio place
(scripts, modules, folders, models, attributes, tags) — so you can understand the whole project
from one read.

## Before searching or opening files

1. Read `.soulgraph/MAP.md` first. In one read it gives you:
   - every Studio script with its path, kind (server / client / module), line count,
     the functions it defines, the modules it `require`s and who uses it;
   - the Studio structure (services, folders, models, attributes, tags);
   - the disk tree with sizes, grouped when there are many similar files.
2. Pick the exact files you need from the map and open **only those**.
   - Studio scripts are mirrored read-only in `.soulgraph/studio/` (Rojo-style names:
     `.server.lua`, `.client.lua`, `.lua` for modules). Read them like normal files.
   - Editing a mirror does nothing. Change Studio code through the Roblox Studio tools
     you have, or through the panel.
3. For exact relationships, grep `.soulgraph/graph.json` — one node or link per line, e.g.
   `grep '"type":"requires"' .soulgraph/graph.json`, or grep a node id.

## If the map is missing or stale

The map is only refreshed while the SoulGraph server is running. If `.soulgraph/MAP.md`
doesn't exist, or it's older than files you just changed, rebuild it:

```bash
npx soulgraph build .
# or, from this plugin's folder (two levels above this skill's base directory):
node <plugin-root>/bin/soulgraph.js build .
```

Studio data only refreshes while Studio is open with the SoulGraph plugin enabled; the
"Roblox Studio" line at the top of the map says when it last synced.

## Live panel

When the user wants to see or explore the project, start the panel (it runs until stopped):

```bash
npx soulgraph serve .
```

Then point them to http://localhost:7777: a 3D graph they can filter, open and edit in real time.

## Notes

- Don't edit anything inside `.soulgraph/` by hand; it's regenerated automatically.
- Requires Node.js 20+.
