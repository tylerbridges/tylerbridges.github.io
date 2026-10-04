const { chromium, webkit } = require('playwright'), assert = require('node:assert/strict');
(async () => {
  for (const engine of process.argv.includes('--webkit') ? [chromium, webkit] : [chromium]) {
    const browser = await engine.launch({ args: engine === chromium ? ['--no-sandbox'] : [] });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 690 }, isMobile: true, hasTouch: true });
      await context.route('https://**/*', route => route.abort());
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://localhost:8003/?test=ice#forecast');
      await page.waitForFunction(() => document.querySelectorAll('[data-weather-time]').length > 0);
      for (const width of [320, 360, 390, 430, 844]) for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: width === 844 ? 390 : 690 });
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        for (const prior of ['sources', 'winter', 'timing']) {
          await page.locator('.forecast-tools-open').scrollIntoViewIfNeeded();
          await page.waitForTimeout(350); // Let the existing floating header finish resizing after scrolling.
          const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
          // Tap without Playwright's automatic scroll to expose modal focus/scroll jumps.
          await page.locator('.forecast-tools-open').evaluate(button => button.click());
          const frames = await page.evaluate(async () => {
            const samples = [];
            for (let i = 0; i < 12; i++) {
              await new Promise(requestAnimationFrame);
              const dialog = document.querySelector('#forecast-tools'), bounds = dialog.getBoundingClientRect();
              samples.push({ x: scrollX, y: scrollY, overflow: dialog.scrollWidth > dialog.clientWidth + 1,
                inside: Array.from(dialog.querySelectorAll('.forecast-tools-tabs button,#forecast-tools-close')).every(button => {
                  const r = button.getBoundingClientRect(); return r.left >= bounds.left + 4 && r.right <= bounds.right - 4 && r.top >= bounds.top && r.bottom <= bounds.bottom;
                }) });
            }
            return samples;
          });
          for (const frame of frames) {
            assert.equal(frame.overflow, false, engine.name() + '/' + width + '/horizontal overflow');
            assert.equal(frame.inside, true, engine.name() + '/' + width + '/buttons outside panel');
            assert.ok(Math.abs(frame.x - before.x) < 1 && Math.abs(frame.y - before.y) < 2, engine.name() + '/' + width + '/opening moved page');
          }
          await page.click('#tool-tab-' + prior);
          await page.keyboard.press('Escape');
          await page.locator('#forecast-tools').waitFor({ state: 'hidden' });
        }
      }
      assert.deepEqual(errors, []);
      console.log('PASS ' + engine.name() + ': repeated More openings, button bounds, no page jumps; five widths, both themes');
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exit(1); });
