# Deployment repo: do not edit site files here

This repo is the built output that GitHub Pages serves at https://tylerbridges.github.io. The next release overwrites the site files, so a fix made here is lost.

| Path | Source repo |
|---|---|
| Root weather site (`index.html`, `app.js`, `wx-*.js`, `check.html`, `sw.js`, icons) | `tylerbridges/rochester-weather` |
| `travel-apps/` | `tylerbridges/packing-list`, `tylerbridges/itinerary-generator`, `tylerbridges/travel-tools-shared` |
| `automation-consulting/` | `tylerbridges/automation-consulting` (static export) |

- To change the site, make the change in the source repo. If it isn't attached to the session, add it; don't patch files here.
- Release with the procedure in `travel-tools-shared` (README, "Source and deployment"), publish the output here, then confirm the live site serves it.
- Keep existing URLs; installed apps and the sign-in callback depend on them.
- Only `AGENTS.md` and `CLAUDE.md` are maintained here by hand. A release must keep them.
