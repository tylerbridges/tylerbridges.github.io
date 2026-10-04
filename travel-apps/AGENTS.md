# AGENTS.md — Travel Apps

Rules for any coding agent (Codex, Claude Code) working in this folder.

## What this is
Two static web apps split out of Tyler's Travel Dashboard (a Claude artifact). The dashboard is separate and is not in this repo; never try to change it from here.
- `packing-list/` — packing checklist built from Tyler's preferences (`preferences.js`).
- `itinerary-generator/` — day-by-day itinerary from trip dates, flights and lodging.
- `shared/` — helpers, local storage (`store.js`), optional Claude adapter (`ai.js`), shell (`shell.js`), styles.

No build step, no dependencies, no framework. Plain ES5-style browser JS loaded with `<script>` tags in a fixed order (see each `index.html`). All paths are relative, so the folder works at the repo root or in a subfolder on GitHub Pages.

## Rules
- Packing List is now a generator: setup → rule-based generation → review → native Notes export. Notes owns packing/check-off; do not reintroduce in-app packing meters or packed/unpacked filters into the main flow. `generator.js` and `generator.css` own this standalone flow; preserve the extracted `packing.js` functions for compatibility. The itinerary app retains its existing flow through optional `APP` hooks in the shared shell.
- The active packing MVP uses `refinement-engine.js` (pure rule groups with dependency declarations), `refinement-state.js` (versioned inputs, assumptions, overrides and a preserved baseline), and `refinement-ui.js` (compact setup and semantic refinements). Keep item identity separate from label and quantity. Refinements rerun affected rules; explicit overrides survive. Legacy items remain pinned until explicitly returned to automatic. Preserve the older generator functions for compatibility.
- `trip/<ID>/pack_meta/refinement` is the structured source for new lists; the existing section/item documents remain the export adapter. Keep profile exclusions in `meta/packing.refinementProfile`, inspectable and resettable. Do not silently learn or remove critical/required items. The MVP has explicit exclusions, not repeated-behavior inference or live forecasts.
- Preserve existing `meta/packing` preferences and trip records. Dates are required for new generation. A separate `trip/<ID>/pack_meta/draft` holds review edits; exported lists retain the established `pack_sections` / `pack_items` shapes. Keep user-selected weather distinct from live forecasts, and keep deterministic rules independent of API keys.
- ENEX native Notes checklists were confirmed by Tyler's device screenshot. Keep the title in the ENEX title field only, section headings in the body, and one `en-todo` element per item.
- The repo is the source of truth; read the current files before editing.
- Make incremental edits. Don't restructure or regenerate whole files unless asked.
- `packing.js` and `itinerary.js` are extracted from the dashboard. Keep their structure and function names so future dashboard changes can be ported; mark standalone-only changes with a `Standalone app:` comment.
- Keep data shapes compatible with the dashboard: `trips/<ID>` (with `bookings` map), `trip/<ID>/pack_sections`, `trip/<ID>/pack_items`, `trip/<ID>/pack_meta/original`, `trip/<ID>/itinerary/main`, `meta/packing`, `templates/<id>`.
- Never commit an API key or any secret. The Claude key is entered in the app's Settings and lives only in the browser.
- Mobile first: works at 360–430px wide, inputs at 16px (no iPhone zoom), light and dark mode.
- Bump the `?v=N` cache-bust query on every changed script/stylesheet in the `index.html` files.
- Itinerary rules (from the dashboard): local times, no "~" on times, realistic arrival times, every flight gets its ground legs (MSP: leave home 3½ hr before, at MSP 2 hr before; elsewhere head to the airport 2½ hr before; after landing get to lodging or head home to Rochester), lodging line only on the check-in day with "N nights", Maps links never carry an origin (the page adds the day's start at display time).
- Packing rules: one item per line, one definite quantity (socks/underwear 2 per travel day, T-shirts 1 per day, shorts/pants days÷2 rounded up, contacts 5 × ceil((days+2)/5)); Before leaving is one-to-one with the list (wallet, ID and bags always; never Global Entry/PreCheck or boarding-pass checks).

## Checks before pushing
- `node tools/check.mjs` passes (syntax of every JS file, every script/stylesheet referenced by the HTML exists).
- `node tests/generator.mjs` passes (quantity rules, preferences, conditional gear, departure dependencies and Notes export).
- `node tests/refinements.mjs` passes (selective regeneration, interactions, overrides, critical protection and legacy migration).
- Optional, if Playwright is available: `node tests/e2e.mjs` (serves the folder and runs both apps end to end).
- Commit task-scoped files only, push to the default branch, then confirm the GitHub Pages build and that the live pages load.
