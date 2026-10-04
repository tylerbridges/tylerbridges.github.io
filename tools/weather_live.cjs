const { chromium } = require('playwright'), assert = require('node:assert/strict');
(async () => {
  const production = process.argv.includes('--production'), base = production ? 'https://tylerbridges.github.io/' : 'http://localhost:8003/';
  if (production) {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const r = await fetch(base + '?deploy-check=' + Date.now(), { cache: 'no-store' });
      const html = await r.text();
      if (r.ok && html.includes('wx-outlook.js?v=139') && html.includes('app.js?v=139')) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    assert.ok(ready, 'Live page must serve the new version');
  }
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
    p.on('pageerror', e => errors.push(e.stack));
    await p.goto(base + '?nostore=1#forecast', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => /Checked|Partial data/.test(document.querySelector('#ftxt').textContent), null, { timeout: 90000 });
    assert.match(await p.locator('#placebtn').innerText(), /Minneapolis/);
    assert.ok(await p.locator('#weather-outlook').isVisible());
    assert.match(await p.locator('#weather-timing').innerText(), /NWS timing/);
    const search = await p.evaluate(async () => {
      const h = await WXLive.geocode('Denver, CO');
      return { label: h.label, covered: await WXLive.covers(h.lat, h.lon) };
    });
    assert.ok(search.covered); assert.match(search.label, /Denver/);
    for (const theme of ['light', 'dark']) for (const width of [360, 390, 430, 1440]) {
      await p.setViewportSize({ width, height: 844 }); await p.evaluate(t => document.documentElement.dataset.theme = t, theme);
      for (const tab of ['daily', 'hourly', 'radar', 'maps']) {
        await p.click('button[data-tab="' + tab + '"]');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      }
    }
    await p.locator('#winter-outlook summary').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-weather-odds]').length === 8, null, { timeout: 90000 });
    console.log('Live winter probabilities:', await p.locator('#winter-odds').innerText());
    await p.click('#forecast-models-tab');
    await p.waitForFunction(() => WXModels._state().ready, null, { timeout: 180000 });
    await p.locator('#model-compare summary').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-compare-map]').length > 0, null, { timeout: 180000 });
    await p.locator('[data-compare-map]').first().click();
    await p.waitForFunction(() => WXModels._state().ready && WXModels._state().window, null, { timeout: 120000 });
    const state = await p.evaluate(() => WXModels._state());
    assert.equal(state.window.end - state.window.start, 24 * 3600000);
    console.log('Live comparison:', await p.locator('#compare-results').innerText());
    await p.click('#model-window-clear');
    assert.equal((await p.evaluate(() => WXModels._state())).window, null);
    assert.deepEqual(errors, []);
    console.log('PASS ' + (production ? 'production' : 'local live data') + ': version, Minneapolis, search, every tab, four widths/two themes, WPC probabilities, real model comparison and lock; no runtime errors');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
