# Dashboard port of the Packing List generator

The Travel Dashboard (a Claude artifact, not in this repo) runs a copy of `packing-list/` as its Packing tab.
The Dashboard copy keeps the standalone files verbatim under `js/packgen/` and puts all Dashboard glue in one file,
`dashboard-adapter.js` (the copy here is the current version). This folder holds that adapter and the test harness.

## Get the Dashboard files

Read the artifact https://claude.ai/artifact/W1KaDoXHcN8z1oEunPP7Nv (Artifact read) and save its files locally:
`index.html`, `styles.css`, `js/*.js`, `trips/*`. Make two copies side by side:

- `dash-orig/` — untouched, for the pixel comparison of non-packing pages
- `dash-port/` — with the port applied

## Apply / re-port into `dash-port/`

1. Copy verbatim from `packing-list/` into `dash-port/js/packgen/`: `preferences`, `rules`, `export`, `generator`,
   `refinement-engine`, `refinement-state`, `autosave`, `learning`, `trip-styles` and `refinement-ui` (`.js`). Copy
   `dashboard-adapter.js` from this folder.
2. Rebuild the scoped CSS: `node tools/scope-css.mjs <travel-apps> <dash-port>` (writes `js/packgen/{base,app,generator}.css`).
3. In `dash-port`, `index.html` loads the three CSS files after `styles.css`, and loads the ten scripts plus the adapter after
   `js/packing.js`. The other Dashboard edits (`js/core.js` `route()` hook, `js/trip.js` Packing tab, `js/boot.js` db wrapper)
   are listed in the adapter's header comment.

## Run the tests (Playwright + Chromium)

```
DASH_PORT=/path/dash-port DASH_ORIG=/path/dash-orig TRAVEL_APPS=/path/travel-apps \
PLAYWRIGHT_MODULE=/path/to/playwright/index.js node run.mjs      # functional + pixel checks
... node visual.mjs                                               # Dashboard vs standalone screenshots, overflow
```

Defaults are `../dash-port`, `../dash-orig`, `../travel-apps`, `./shots` and the `playwright` package.
`mock-claude.js` is injected before page scripts: an in-memory `window.claude` with the async `db`
(seeded from `trips/*.json`, plus legacy Wyoming packing docs) and a `downloads` capability (`window.__mockDl` =
`"declined"` / `"fail"` to test those paths). Screenshots go to `SHOTS`.
