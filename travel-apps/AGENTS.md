# AGENTS.md — Travel Apps

Rules for any coding agent (Codex, Claude Code) working in this folder.

## What this is
Two static web apps split out of Tyler's Travel Dashboard (a Claude artifact). The dashboard is separate and is not in this repo; never try to change it from here.
- `packing-list/` — packing checklist built from Tyler's preferences (`preferences.js`).
- `itinerary-generator/` — day-by-day itinerary from trip dates, flights and lodging.
- `shared/` — helpers, local storage (`store.js`), optional Claude adapter (`ai.js`), shell (`shell.js`), styles.

No build step, no dependencies, no framework. Plain ES5-style browser JS loaded with `<script>` tags in a fixed order (see each `index.html`). All paths are relative, so the folder works at the repo root or in a subfolder on GitHub Pages.

## Rules
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
- Optional, if Playwright is available: `node tests/e2e.mjs` (serves the folder and runs both apps end to end).
- Commit task-scoped files only, push to the default branch, then confirm the GitHub Pages build and that the live pages load.
