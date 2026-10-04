const { chromium } = require('playwright'), assert = require('node:assert/strict');
const H = 3600000;
function section(n, length) { const b = Buffer.alloc(length); b.writeUInt32BE(length); b[4] = n; return b; }
function grib(value, missing) {
  const g = section(3, 72); g.writeUInt32BE(100, 30); g.writeUInt32BE(40, 34); g.writeUInt32BE(30e6, 46); g.writeUInt32BE(225e6, 50); g.writeUInt32BE(1e6, 63); g.writeUInt32BE(1e6, 67); g[71] = 64;
  const s = section(5, 21); s.writeUInt32BE(missing ? 3999 : 4000, 5); s.writeFloatBE(value, 11);
  const bm = section(6, missing ? 506 : 6); bm[5] = missing ? 0 : 255;
  if (missing) { bm.fill(255, 6); const k = 15 * 100 + 42; bm[6 + (k >> 3)] &= ~(1 << (7 - (k & 7))); }
  const d = section(7, 5), header = Buffer.alloc(16); header.write('GRIB'); header[7] = 2; header.writeUInt32BE(16 + g.length + s.length + bm.length + d.length + 4, 12);
  return Buffer.concat([header, g, s, bm, d, Buffer.from('7777')]);
}
const fileCache = new Map();
function file(h) {
  if (fileCache.has(h)) return fileCache.get(h);
  let offset = 0, lines = [], parts = [];
  function add(v, l, t, value, missing) { const buf = grib(value, missing); lines.push((lines.length + 1) + ':' + offset + ':d=2026100421:' + v + ':' + l + ':' + t + ':'); parts.push(buf); offset += buf.length; }
  for (const [v, l, value] of [['TMP', '2 m above ground', 270], ['REFC', 'entire atmosphere', 30], ['CRAIN', 'surface', 0], ['CSNOW', 'surface', 1], ['CFRZR', 'surface', 0], ['CICEP', 'surface', 0], ['GUST', 'surface', 15]]) add(v, l, h === 0 ? 'anl' : h + ' hour fcst', value, false);
  for (let a = 0; a < h; a++) for (const [v, value] of [['APCP', h - a], ['WEASD', h - a], ['ASNOW', (h - a) * 0.01], ['FRZR', h - a], ['FICEAC', h - a]]) add(v, 'surface', a + '-' + h + ' hour acc fcst', value, v === 'APCP' && h === 24);
  const f = { idx: lines.join('\n'), body: Buffer.concat(parts) }; fileCache.set(h, f); return f;
}
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } }), p = await ctx.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.stack));
    await ctx.route('https://**/*', async r => {
      const u = new URL(r.request().url());
      if (!/noaa-(?:hrrr|nam|gfs|nbm).*amazonaws|storage.googleapis/.test(u.host)) { await r.abort(); return; }
      if (u.searchParams.has('prefix')) {
        const pre = u.searchParams.get('prefix'), gfs = pre.includes('pgrb2'); const keys = [];
        for (let h = 0; h <= 384; h++) {
          const hh = String(h).padStart(gfs || pre.includes('core.f') ? 3 : 2, '0');
          keys.push(pre + hh + (gfs ? '' : pre.includes('hiresf') || pre.includes('awphys') ? '.tm00.grib2' : pre.includes('core.f') ? '.co.grib2' : '.grib2') + '.idx');
        }
        await r.fulfill({ contentType: u.host === 'storage.googleapis.com' ? 'application/json' : 'application/xml',
          body: u.host === 'storage.googleapis.com' ? JSON.stringify({ items: keys.map(name => ({ name })) }) : '<ListBucketResult>' + keys.map(k => '<Contents><Key>' + k + '</Key></Contents>').join('') + '</ListBucketResult>' }); return;
      }
      const path = decodeURIComponent(u.pathname), m = /(?:wrfsfcf|wrfprsf|hiresf|awphys|pgrb2\.0p25\.f|core\.f)(\d+)/.exec(path);
      if (!m) { await r.abort(); return; } const f = file(+m[1]);
      if (path.endsWith('.idx')) await r.fulfill({ body: f.idx });
      else { const range = /bytes=(\d+)-(\d*)/.exec(r.request().headers()['range']); const a = range ? +range[1] : 0, z = range && range[2] ? +range[2] + 1 : f.body.length; await r.fulfill({ status: 206, contentType: 'application/octet-stream', body: f.body.subarray(a, z) }); }
    });
    await p.goto('http://localhost:8003/?test=ice#forecast');
    await p.waitForFunction(() => document.querySelectorAll('[data-weather-time]').length > 0);
    assert.match(await p.locator('#weather-timing').innerText(), /Freezing rain possible/);
    await p.locator('[data-weather-time]').first().click();
    await p.waitForFunction(() => WXModels._state().ready, null, { timeout: 60000 });
    assert.equal((await p.evaluate(() => WXModels._state())).param, 'ptype');
    assert.equal(await p.evaluate(() => WXArchive.read().forecasts.length), 0);
    await p.locator('#model-compare summary').click();
    await p.waitForFunction(() => document.querySelectorAll('[data-compare-map]').length >= 3, null, { timeout: 60000 });
    await p.locator('[data-compare-map]').first().click();
    await p.waitForFunction(() => WXModels._state().ready && WXModels._state().window);
    let s = await p.evaluate(() => WXModels._state());
    assert.equal(s.window.end - s.window.start, 24 * H); assert.equal(s.hours.length, 1);
    assert.equal(await p.locator('#mplay').isDisabled(), true);
    await p.click('#model-window-clear'); assert.equal((await p.evaluate(() => WXModels._state())).window, null);
    await p.selectOption('#compare-mode', 'trends');
    await p.waitForFunction(() => document.querySelectorAll('[data-compare-map]').length >= 2, null, { timeout: 60000 });
    assert.match(await p.locator('#compare-results').innerText(), /exact period/);
    await p.selectOption('#compare-kind', 'native');
    await p.waitForFunction(() => document.querySelector('#compare-results').textContent.includes('Snowfall · native'));
    await p.locator('[data-compare-map]').first().click();
    await p.waitForFunction(() => WXModels._state().ready && WXModels._state().param === 'snv');
    const calc = await p.evaluate(async () => {
      const run = WXModels._state().run, o = { run, from: 6, lat: 45, lon: -94, want: 1200 };
      const a = await WXModels._probe('hrrr', 'qpf', 24, o);
      const n = await WXModels._probe('hrrr', 'qpf', 24, { ...o, lon: -93 });
      const snow = await WXModels._probe('hrrr', 'snv', 30, { ...o, from: 6 });
      return { qpf: a.at, missing: n.at, native: snow.at };
    });
    assert.ok(Math.abs(calc.qpf - 18 / 25.4) < 1e-5); assert.equal(Number.isNaN(calc.missing), true);
    assert.ok(Math.abs(calc.native - 0.24 * 39.3701) < 1e-5); console.log('Controlled GRIB results:', calc);
    await p.click('#model-window-clear');
    for (const theme of ['light', 'dark']) for (const width of [360, 390, 430, 1440]) {
      await p.setViewportSize({ width, height: 844 }); await p.evaluate(t => document.documentElement.dataset.theme = t, theme);
      for (const tab of ['daily', 'hourly', 'radar', 'maps']) {
        await p.click('button[data-tab="' + tab + '"]');
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, theme + '/' + width + '/' + tab);
      }
      assert.ok(await p.locator('#compare-kind').evaluate(e => parseFloat(getComputedStyle(e).fontSize) >= 16));
    }
    await p.goto('http://localhost:8003/?test=severe#forecast');
    await p.waitForFunction(() => document.querySelector('#weather-timing').textContent.includes('Thunderstorms possible'));
    assert.match(await p.locator('#weather-timing').innerText(), /Rain possible/);
    await p.click('#weather-alert-details'); assert.ok(await p.locator('#now').isVisible());
    await p.click('button[data-tab="maps"]');
    await p.evaluate(() => {
      const a = WXArchive.read(), end = Math.floor(Date.now() / 3600000) * 3600000, start = end - 24 * 3600000, lat = 44.9778, lon = -93.265;
      a.forecasts.push({ id: 'test', source: 'nws', label: 'NWS point forecast', lat, lon, issued: start - 3600000, recordedAt: start - 3600000, grid: { snow: [[start, 24, 5]], qpf: [[start, 24, 1]], ice: [[start, 24, 0]] } });
      a.reports.push({ id: 'test', kind: 'snow', city: 'Test report', lat, lon, value: 6, start, end, measured: true });
      WXOutlook.show({ via: 'test', loc: { lat, lon, label: 'Minneapolis, MN' }, grid: { start, n: 0, s: {} }, updated: { grid: start }, alerts: [] }, { fmt: t => new Date(t).toISOString() });
    });
    await p.locator('#weather-history summary').click();
    assert.match(await p.locator('#weather-verification').innerText(), /Forecast 5.00 in · observed 6.00 in · difference -1.00 in/);
    const dl = p.waitForEvent('download'); await p.click('#weather-export'); assert.equal((await dl).suggestedFilename(), 'weather-issued-forecasts.json');
    assert.deepEqual(errors, []);
    console.log('PASS controlled browser: exact windows, native units, missing cells, map links, storm/winter scenarios, archive/export, layouts, no runtime errors');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
