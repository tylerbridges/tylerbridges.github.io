// Full harness for the Dashboard packing-generator port. node run.mjs
import {readFile} from 'node:fs/promises';
import {mkdir} from 'node:fs/promises';
import {serve, seed, open, PW, DIRS, check} from './lib.mjs';
await mkdir(DIRS.shots, {recursive:true});
const SHOTS = DIRS.shots, PHX = 'PHX-2026-10-08', WY = 'REPLACEMENT-2026-09-19';
const port = await serve(DIRS.port), orig = await serve(DIRS.orig);
const data = await seed(DIRS.port);
const browser = await PW.chromium.launch(), R = [], allErrors = [];
const store = (page) => page.evaluate(() => window.__mock.store());
const packDocs = (s, id) => Object.keys(s).filter(p => p.startsWith('trip/' + id + '/pack_'));
async function settle(page, ms = 600){ await page.waitForTimeout(ms); }
try {
  // ---------- 1. Home, overview, itinerary still render ----------
  let {ctx, page, errors} = await open(browser, port.url, data);
  await page.goto(port.url); await page.waitForSelector('.tcard, .hero, a[href^="#PHX"]', {timeout:8000}); await settle(page, 2500);
  check(R, 'home renders', (await page.textContent('#h1')).includes('Travel Dashboard') && (await page.locator('a[href="#' + PHX + '"]').count()) > 0);
  await page.goto(port.url + '#' + PHX); await settle(page, 1200);
  check(R, 'PHX overview renders', (await page.textContent('#h1')).includes('Phoenix Trip') && (await page.locator('#tasks').count()) === 1 && (await page.locator('#bookings').count()) === 1);
  await page.goto(port.url + '#' + PHX + '.itinerary'); await settle(page, 1500);
  check(R, 'PHX itinerary tab renders', (await page.locator('.tabs a[aria-current="page"]').textContent()) === 'Itinerary' && (await page.locator('#packgen').count()) === 0 && (await page.textContent('#view')).length > 200);

  // ---------- 2. PHX Packing: setup prefilled ----------
  await page.goto(port.url + '#' + PHX + '.packing'); await page.waitForSelector('#packgen #rs-where', {timeout:8000});
  const pre = {where:await page.inputValue('#rs-where'), mode:await page.inputValue('#rs-mode'), sum:(await page.locator('.rp-sum b').allTextContents()).join(' / ')};
  check(R, 'setup prefilled from trip', pre.where === 'Phoenix, AZ' && pre.sum === 'Thu, Oct 8 / Tue, Oct 13' && pre.mode === 'fly' && (await page.locator('button:has-text("Generate my list")').count()) === 1, JSON.stringify(pre));
  check(R, 'trip style picker on no-list setup', (await page.locator('#packgen #rs-style option').count()) >= 6);
  check(R, 'no old checklist UI (meters/filters/checkboxes)', (await page.locator('.meter, #pf-all, #pf-left, .pitem').count()) === 0);
  await page.screenshot({path:SHOTS + 'phx-setup-390-light.png', fullPage:true});

  // ---------- 3. Generate ----------
  await page.click('button:has-text("Generate my list")'); await page.waitForSelector('#rr-export', {timeout:8000});
  await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; }, null, {timeout:8000}); await settle(page);
  let s = await store(page);
  const secs = packDocs(s, PHX).filter(p => p.includes('/pack_sections/')), items = packDocs(s, PHX).filter(p => p.includes('/pack_items/'));
  const secOk = secs.length > 4 && secs.every(p => { const d = s[p]; return typeof d.title === 'string' && typeof d.order === 'number' && typeof d.depart === 'boolean' && 'note' in d; });
  const itOk = items.length > 20 && items.every(p => { const d = s[p]; return typeof d.label === 'string' && s['trip/' + PHX + '/pack_sections/' + d.section] && typeof d.order === 'number' && d.checked === false && typeof d.at === 'number'; });
  check(R, 'generate → Trip plan cards + list shown', (await page.locator('.trip-plan-card').count()) >= 6 && (await page.textContent('.gen-review')).includes('Your packing list') && /#PHX-2026-10-08\.packing$/.test(page.url()), page.url());
  check(R, 'first generation offers no Undo back to an empty plan', (await page.locator('button:has-text("Undo last change")').count()) === 0 && !s['trip/' + PHX + '/pack_meta/refinement'].undo);
  check(R, 'trips/PHX.packing true', s['trips/' + PHX].packing === true && s['trips/' + PHX].packingDeleted === false && Object.keys(s['trips/' + PHX].bookings).length === 6);
  check(R, 'pack_sections/pack_items in shared shapes', secOk && itOk, secs.length + ' sections, ' + items.length + ' items');
  check(R, 'pack_meta/refinement + original written', s['trip/' + PHX + '/pack_meta/refinement']?.version === 2 && s['trip/' + PHX + '/pack_meta/original']?.context?.source === 'generator');
  await page.screenshot({path:SHOTS + 'phx-list-390-light.png', fullPage:true});

  // ---------- 4. ENEX ----------
  const exportVia = async (sel) => { const n = await page.evaluate(() => window.__mock.downloads.length); await page.click(sel); await page.waitForFunction(n => window.__mock.downloads.length > n, n); return page.evaluate(() => window.__mock.downloads[window.__mock.downloads.length - 1]); };
  let got = await exportVia('#pe-enex'), enex = got.text; await settle(page, 300);
  const st = await page.locator('#rr-outfitSummary p.muted[role=status]').textContent();
  check(R, 'ENEX via downloads capability: en-todo with no trailing space', got.filename === 'Phoenix Trip Packing List.enex' && enex.includes('<en-todo checked="false"/>') && !/<en-todo checked="false"\/>\s/.test(enex) && enex.includes('<title>Phoenix Trip — Packing List</title>'), got.filename);
  check(R, 'export status reflects save', st.startsWith('Saved Phoenix Trip Packing List.enex'), st);
  await settle(page); s = await store(page);
  check(R, 'export record saved (pack_meta/export)', !!s['trip/' + PHX + '/pack_meta/export']?.fingerprint);
  check(R, 'Copy/Markdown under More export options', await page.locator('#pe-copy, #pe-md').evaluateAll(xs => xs.length === 2 && xs.every(x => !!x.closest('details'))));

  // ---------- 5. Reload: rebuilt from db ----------
  const countBefore = await page.locator('.refine-item').count();
  await page.reload(); await page.waitForSelector('#rr-export', {timeout:10000}); await settle(page, 800);
  check(R, 'reload → list persists (mirror rebuilt from db)', (await page.locator('.refine-item').count()) === countBefore && countBefore > 20 && await page.locator('#rr-export-changed').isHidden(), countBefore + ' rows');

  // ---------- 6. Edit → export-changed banner ----------
  await page.locator('[data-item-id="pack:tshirts"]').getByRole('button', {name:'Edit', exact:true}).click();
  await page.waitForSelector('.sheet-bg.packgen #ri-quantity'); await page.fill('#ri-quantity', '9'); await page.click('button:has-text("Save override")');
  await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  check(R, 'edit item → export-changed banner', await page.locator('#rr-export-changed').isVisible() && (await page.textContent('#rr-export-changed')).includes('Changed since your last export'));
  await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; });
  const recBefore = (await store(page))['trip/' + PHX + '/pack_meta/export'];
  await page.evaluate(() => { window.__mockDl = 'declined'; }); await page.click('#pe-enex'); await settle(page, 1500);
  await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; });
  check(R, 'declined save: silent, banner stays, record restored', (await page.locator('#rr-outfitSummary p.muted[role=status]').textContent()).indexOf('Saved') < 0 && await page.locator('#rr-export-changed').isVisible() && JSON.stringify((await store(page))['trip/' + PHX + '/pack_meta/export']) === JSON.stringify(recBefore));
  await page.evaluate(() => { window.__mockDl = 'fail'; }); await page.click('#pe-enex'); await settle(page, 2000);
  check(R, 'failed save: "Couldn\'t save" status', (await page.locator('#rr-outfitSummary p.muted[role=status]').textContent()).includes("Couldn't save the file here"));
  await settle(page, 1500); await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; });
  await page.evaluate(() => { window.__mockDl = ''; }); got = await exportVia('#pe-enex'); enex = got.text; await settle(page);
  check(R, 're-export clears banner, uses edited quantity', enex.includes('T-shirts ×9') && await page.locator('#rr-export-changed').isHidden());
  await page.locator('#rr-outfitSummary details').evaluate(x => x.open = true); got = await exportVia('#pe-md');
  check(R, 'Markdown via downloads capability', got.filename === 'Phoenix Trip Packing List.md' && got.text.includes('- [ ] T-shirts ×9'));

  // ---------- 7. Delete list + Undo ----------
  s = await store(page); const before = {pack:packDocs(s, PHX).sort(), others:Object.keys(s).filter(p => !p.startsWith('trip/' + PHX + '/pack_') && p !== 'trips/' + PHX && !p.startsWith('meta/packingLearning')).sort(), header:s['trips/' + PHX]};
  await page.evaluate(id => localStorage.setItem('ta:meta/packingFormDrafts/' + encodeURIComponent('add:' + id), JSON.stringify({version:1, context:'x', data:{}})), PHX);
  await page.click('button:has-text("Delete list")'); await page.waitForSelector('#packgen #rs-where', {timeout:8000}); await page.waitForSelector('.packing-delete-toast'); await settle(page);
  s = await store(page);
  const otherNow = Object.keys(s).filter(p => !p.startsWith('trip/' + PHX + '/pack_') && p !== 'trips/' + PHX && !p.startsWith('meta/packingLearning')).sort();
  const hdr = s['trips/' + PHX];
  check(R, 'Delete list removes only packing docs', packDocs(s, PHX).length === 0 && JSON.stringify(otherNow) === JSON.stringify(before.others) && JSON.stringify(hdr.bookings) === JSON.stringify(before.header.bookings) && hdr.packingDeleted === true && hdr.packing === false && hdr.name === 'Phoenix Trip'
    && await page.evaluate(id => localStorage.getItem('ta:meta/packingFormDrafts/' + encodeURIComponent('add:' + id)) === null, PHX), packDocs(s, PHX).length + ' pack docs left');
  check(R, 'after delete: stays on Packing tab with setup', /#PHX-2026-10-08\.packing$/.test(page.url()), page.url());
  await page.click('.packing-delete-toast button:has-text("Undo")'); await page.waitForSelector('#rr-export', {timeout:8000}); await settle(page, 800);
  s = await store(page);
  check(R, 'Undo restores list and flags', JSON.stringify(packDocs(s, PHX).sort()) === JSON.stringify(before.pack) && s['trips/' + PHX].packing === true && s['trips/' + PHX].packingDeleted === false && (await page.locator('.refine-item').count()) === countBefore);

  // ---------- 8. Preferences sheet saves meta/packing ----------
  await page.click('button:has-text("Packing preferences")'); await page.waitForSelector('.sheet-bg.packgen #gp-addName', {state:'attached'});
  await page.click('.sheet-bg summary:has-text("Add usual item")'); await page.fill('#gp-addName', 'Test umbrella'); await page.click('.sheet-bg button:has-text("Add item")');
  await page.click('button:has-text("Save my preferences")'); await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  s = await store(page); const mp = s['meta/packing'];
  check(R, 'preferences sheet saves meta/packing (old fields kept)', Array.isArray(mp.prefItems) && JSON.stringify(mp).includes('Test umbrella') && JSON.stringify(mp.rules) === JSON.stringify(['Old dashboard rule']) && Array.isArray(mp.extras) && mp.extras.length > 3);
  check(R, 'page still on review after prefs save', (await page.locator('#rr-export').count()) === 1);

  // ---------- 8b. Trip details route + rules page ----------
  await page.click('a.trip-plan-card[aria-label^="Trip details"]'); await page.waitForSelector('#packgen form h2:has-text("Trip details")');
  check(R, 'Trip details card → #ID.packing.edit (no style picker)', /\.packing\.edit$/.test(page.url()) && (await page.locator('#rs-style').count()) === 0);
  await page.click('#packgen a:has-text("Cancel")'); await page.waitForSelector('#rr-export');
  check(R, 'Trip details Cancel → back to list', /\.packing$/.test(page.url()));

  // ---------- 8c. Start from a past trip (Kauai from PHX), short-quantity warning, Sandals, new styles ----------
  const KA = 'KAUAI-2026-09-19', ready = () => page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; }, null, {timeout:8000});
  await page.click('#rr-add'); await page.waitForSelector('.sheet-bg.packgen #ra-label'); await page.fill('#ra-label', 'Travel pillow'); await page.click('.sheet-bg button:has-text("Add item")'); await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  const rmId = await page.evaluate(id => { const r = refineEvaluate(refineLoad(TRIPS[id]), generatorPrefs(), []); const x = r.items.find(i => !i.required && !i.critical && !i.manual && i.section === 'Personal bag & day gear' && /costa sunglasses|kindle|snacks|anker/i.test(i.label)) || r.items.find(i => !i.required && !i.critical && !i.manual && i.section === 'Personal bag & day gear'); return x && {id:x.id, label:x.label}; }, PHX);
  await page.locator(`[data-item-id="${rmId.id}"]`).getByRole('button', {name:'Remove', exact:true}).click(); await page.click('.sheet-bg button:has-text("Remove for this trip")'); await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  await page.goto(port.url + '#' + KA + '.packing'); await page.waitForSelector('#packgen #rs-past', {timeout:8000});
  const styleOpts = await page.locator('#rs-style option').allTextContents();
  check(R, 'new built-in styles listed', JSON.stringify(styleOpts.slice(0, 6)) === JSON.stringify(['Usual defaults','Weekend','Wedding / event weekend','Beach / Hawaii','Hiking (cooler)','International']), styleOpts.join(', '));
  const pastOpts = await page.locator('#rs-past option').evaluateAll(xs => xs.map(x => x.value));
  check(R, 'past-trip select lists the trip with a list (not itself, not legacy Wyoming)', pastOpts.includes(PHX) && !pastOpts.includes(KA) && !pastOpts.includes(WY), pastOpts.join(','));
  await page.selectOption('#rs-past', PHX); const pnote = await page.textContent('#rs-style-note');
  check(R, 'past-trip note says what carries over', /Reusing Phoenix Trip/.test(pnote) && /1 added item, 1 removal carry over/.test(pnote), pnote);
  await page.selectOption('#rs-style', 'weekend'); const ex1 = await page.inputValue('#rs-past');
  await page.selectOption('#rs-past', PHX); const ex2 = await page.inputValue('#rs-style');
  check(R, 'past trip and style are mutually exclusive', ex1 === '' && ex2 === '' && await page.inputValue('#rs-mode') === 'fly');
  await page.click('button:has-text("Generate my list")'); await page.waitForSelector('#rr-export', {timeout:8000}); await settle(page);   // 9-day trip: export waits on the laundry decision
  const ks = await page.evaluate(([id, rm]) => { const s = refineLoad(TRIPS[id]), r = refineEvaluate(s, generatorPrefs(), []); return {added:Object.values(s.overrides.added).map(x => x.label), removed:!!s.overrides.removed[rm], edited:Object.keys(s.overrides.edited), carried:!!s.carried, tshirts:(r.items.find(x => x.id === 'pack:tshirts') || {}).quantity, days:refineDays(s.inputs.start, s.inputs.end)}; }, [KA, rmId.id]);
  const ktext = await page.textContent('#packgen .gen-review');
  check(R, 'past trip carries added item + removal, fresh quantities', ks.added.includes('Travel pillow') && ks.removed && ks.edited.length === 0 && ks.carried && ks.tshirts !== 9 && ktext.includes('Travel pillow') && !ktext.includes(rmId.label + '\n'), JSON.stringify(ks));
  // short-quantity: pin T-shirts at today's automatic amount, then extend the trip in Trip details
  await page.locator('[data-item-id="pack:tshirts"]').getByRole('button', {name:'Edit', exact:true}).click(); await page.waitForSelector('#ri-quantity');
  const autoQ = +(await page.inputValue('#ri-quantity')); await page.fill('#ri-label', 'Tees'); await page.click('button:has-text("Save override")'); await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  await page.click('a.trip-plan-card[aria-label^="Trip details"]'); await page.waitForSelector('#packgen form h2:has-text("Trip details")');
  await page.locator('.rp-sum button').nth(1).click(); await page.locator('.rp-grid button[aria-label*="Sep 30"]').click(); await page.getByRole('button', {name:'OK', exact:true}).click();
  await page.click('button:has-text("Update trip & recalculate")'); await page.waitForSelector('#rr-export', {timeout:8000}); await settle(page);
  const warnText = await page.locator('.refine-warning').textContent().catch(() => '');
  check(R, 'short-quantity warning after date extension (Trip details)', new RegExp('Tees ×' + autoQ + ' is below the \\d+ this trip now needs').test(warnText) && (await page.locator('.refine-warning button:has-text("Use new amount")').count()) === 1 && (await store(page))['trips/' + KA].end === '2026-09-30', warnText.slice(0, 120));
  await page.click('.refine-warning button:has-text("Use new amount")'); await settle(page, 800);
  const newQ = await page.evaluate(id => refineLoad(TRIPS[id]).overrides.edited['pack:tshirts'].quantity, KA);
  check(R, 'Use new amount clears the warning', newQ > autoQ && !/is below the/.test(await page.locator('#packgen').textContent()), autoQ + ' → ' + newQ);
  // Sandals on a swimming trip (Activities card)
  await page.click('button.trip-plan-card[aria-label="Activities"]'); await page.check('#rf-water'); await page.click('button:has-text("Apply & recalculate")'); await page.waitForSelector('.sheet-bg', {state:'detached'}); await settle(page);
  check(R, 'Sandals on a swimming trip', (await page.locator('#packgen .gen-review section:has(h3:text-is("Clothing"))').textContent()).includes('Sandals'));
  await page.goto(port.url + '#' + PHX + '.packing'); await page.waitForSelector('#rr-export'); await settle(page);

  // ---------- 9. Layout at 360/390/430 light/dark ----------
  let overflowOk = true, notes = [];
  for (const width of [360, 390, 430]) for (const scheme of ['light', 'dark']){
    await page.setViewportSize({width, height:844}); await page.emulateMedia({colorScheme:scheme}); await settle(page, 200);
    const ok = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#packgen *')].every(e => e.getBoundingClientRect().right <= innerWidth + 0.5));
    if (!ok){ overflowOk = false; notes.push(width + scheme); }
    await page.screenshot({path:`${SHOTS}phx-list-${width}-${scheme}.png`, fullPage:false});
  }
  check(R, 'no horizontal overflow 360/390/430 light+dark (review)', overflowOk, notes.join(','));
  await page.goto(port.url + '#DULUTH-2026-10-23.packing'); await page.waitForSelector('#packgen #rs-past'); overflowOk = true; notes = [];
  for (const width of [360, 390, 430]) for (const scheme of ['light', 'dark']){
    await page.setViewportSize({width, height:844}); await page.emulateMedia({colorScheme:scheme}); await settle(page, 200);
    if (!await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#packgen *')].every(e => e.getBoundingClientRect().right <= innerWidth + 0.5))){ overflowOk = false; notes.push(width + scheme); }
    await page.locator('#packgen').screenshot({path:`${SHOTS}duluth-setup-past-${width}-${scheme}.png`});
  }
  check(R, 'no horizontal overflow 360/390/430 light+dark (setup with past-trip select)', overflowOk, notes.join(','));
  await page.goto(port.url + '#' + PHX + '.packing'); await page.waitForSelector('#rr-export'); await settle(page);
  await page.setViewportSize({width:390, height:844}); await page.emulateMedia({colorScheme:'dark'});
  await page.click('button:has-text("Packing preferences")'); await page.waitForSelector('.sheet-bg.packgen'); await settle(page, 300);
  await page.screenshot({path:SHOTS + 'prefs-sheet-390-dark.png'}); await page.keyboard.press('Escape');
  await page.emulateMedia({colorScheme:'light'});
  allErrors.push(...errors.map(e => 'main: ' + e)); await ctx.close();

  // ---------- 10. Wyoming legacy ----------
  ({ctx, page, errors} = await open(browser, port.url, data, {mock:{noDownloads:true}}));
  await page.goto(port.url + '#' + WY + '.packing'); await page.waitForSelector('#rr-export', {timeout:10000});
  await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; }, null, {timeout:8000}); await settle(page, 800);
  s = await store(page);
  const wyItems = packDocs(s, WY).filter(p => p.includes('/pack_items/')).map(p => s[p]);
  const legacyLabels = ['Brooks running shoes','Sweatshirt / hoodie','T-shirts ×8','Socks ×15','Underwear ×15','Lulu shorts ×4','Bear spray','Toothbrush','Toothpaste','Contacts ×10','Binoculars','AirPods'];
  const text = await page.textContent('#packgen');
  check(R, 'Wyoming opens in legacy/pinned mode', text.includes('Saved list · automatic refinement is off') && (await page.locator('.refine-badge:has-text("Manual override")').count()) === legacyLabels.length);
  check(R, 'Wyoming items intact in UI and db', legacyLabels.every(l => text.includes(l)) && legacyLabels.every(l => wyItems.some(x => x.label === l)), wyItems.length + ' items in db');
  const bs = wyItems.find(x => x.label === 'Bear spray'), ts = wyItems.find(x => x.label === 'T-shirts ×8');
  check(R, 'Wyoming hints/packed state/baseline kept', bs?.hint === 'Buy in Jackson' && ts?.checked === true && s['trip/' + WY + '/pack_meta/original']?.context?.source === 'builder' && !s['trip/' + WY + '/pack_meta/refinement']);
  const writes1 = (await page.evaluate(() => window.__mock.log.length));
  await page.reload(); await page.waitForSelector('#rr-export'); await page.waitForFunction(() => { const b = document.querySelector('#pe-enex'); return b && !b.disabled; }); await settle(page, 800);
  const log2 = await page.evaluate(() => window.__mock.log.filter(x => /REPLACEMENT-2026-09-19\/pack_(sections|items)/.test(x[1])).length);
  check(R, 'Wyoming reopen does not rewrite list docs', log2 === 0, log2 + ' pack writes after reload');
  await page.screenshot({path:SHOTS + 'wyoming-legacy-390-light.png', fullPage:true});
  let adl = page.waitForEvent('download', {timeout:5000}); await page.click('#pe-enex'); const af = await adl, at = await readFile(await af.path(), 'utf8');
  check(R, 'no downloads capability → anchor download fallback', af.suggestedFilename() === 'wyoming-trip-packing-list.enex' && at.includes('<en-todo checked="false"/>Bear spray'), af.suggestedFilename());
  allErrors.push(...errors.map(e => 'wy: ' + e)); await ctx.close();

  // ---------- 10b. Trip styles in the no-list setup; non-generator sheet unscoped ----------
  ({ctx, page, errors} = await open(browser, port.url, data));
  await page.goto(port.url); await page.waitForSelector('a[href^="#PHX"]'); await settle(page, 1500);
  const costChip = page.locator('button:has-text("＋ Cost")').first();
  if (await costChip.count()){ await costChip.click(); await page.waitForSelector('.sheet-bg'); check(R, 'Dashboard sheet outside Packing tab not scoped', (await page.locator('.sheet-bg.packgen').count()) === 0); await page.keyboard.press('Escape'); }
  else check(R, 'Dashboard sheet outside Packing tab not scoped (no ＋ Cost chip found)', false);
  const DU = 'DULUTH-2026-10-23';
  await page.goto(port.url + '#' + DU + '.packing'); await page.waitForSelector('#packgen #rs-style');
  await page.selectOption('#rs-style', 'weekend');
  check(R, 'style select applies standalone handler (Weekend → Driving, note)', await page.inputValue('#rs-mode') === 'drive' && await page.locator('#packgen h2.k + .field + p.gen-note').isVisible() && (await page.textContent('#packgen')).includes('Reusing Weekend'));
  await page.selectOption('#rs-style', 'wedding-weekend');
  check(R, 'Wedding style → Outfit needs shown, counts 0, Flying', await page.locator('#rs-occasions').isChecked() && await page.locator('#rs-formalDays').isVisible() && await page.inputValue('#rs-formalDays') === '0' && await page.inputValue('#rs-mode') === 'fly' && await page.inputValue('#rs-type') === 'event');
  await page.fill('#rs-dinners', '1'); await page.click('button:has-text("Generate my list")'); await page.waitForSelector('#rr-export'); await settle(page);
  const ws = await page.evaluate(id => { const s = refineLoad(TRIPS[id]); return {type:s.inputs.tripType, mode:s.inputs.mode, laundry:s.refinements.laundry, pending:refinePendingDecisions(s), dinners:s.refinements.dinners}; }, DU);
  check(R, 'generated with style (trip type event, laundry from style, Events confirmed)', ws.type === 'event' && ws.mode === 'fly' && ws.laundry.available === false && ws.laundry.firstWash === 4 && !ws.pending.includes('Events') && ws.pending.includes('Dinner outfit') && ws.dinners === 1, JSON.stringify(ws));
  await page.goto(port.url + '#' + DU + '.packing.edit'); await page.waitForSelector('#packgen form');
  check(R, 'style picker hidden once a list exists', (await page.locator('#rs-style').count()) === 0);
  allErrors.push(...errors.map(e => 'styles: ' + e)); await ctx.close();

  // ---------- 11. Read-only db ----------
  ({ctx, page, errors} = await open(browser, port.url, data, {mock:{noDb:true}}));
  await page.goto(port.url + '#' + PHX + '.packing'); await settle(page, 2500);
  check(R, 'read-only view says it cannot save', (await page.textContent('#packgen')).includes("can't be generated or saved") && (await page.locator('#rs-where').count()) === 0);
  allErrors.push(...errors.map(e => 'ro: ' + e)); await ctx.close();

  // ---------- 12. Non-packing pages unchanged vs dash-orig ----------
  const diffs = [];
  for (const [name, hash] of [['home', ''], ['overview', '#' + PHX], ['itinerary', '#' + PHX + '.itinerary'], ['dark-home', '']]){
    const shots = [];
    for (const [label, srv] of [['orig', orig], ['port', port]]){
      const o = await open(browser, srv.url, data, {colorScheme: name.startsWith('dark') ? 'dark' : 'light'});
      await o.page.goto(srv.url + hash); await settle(o.page, 3000);
      await o.page.evaluate(() => { const st = document.createElement('style'); st.textContent = '*{caret-color:transparent!important;animation:none!important;transition:none!important}'; document.head.appendChild(st); });
      const buf = await o.page.screenshot({path:`${SHOTS}cmp-${name}-${label}.png`, fullPage:true}); shots.push(buf);
      allErrors.push(...o.errors.map(e => label + ' ' + name + ': ' + e)); await o.ctx.close();
    }
    const cmp = await open(browser, port.url, data);
    const res = await cmp.page.evaluate(async ([a, b]) => {
      const load = src => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + src; });
      const [x, y] = await Promise.all([load(a), load(b)]); if (x.width !== y.width || x.height !== y.height) return {same:false, why:`size ${x.width}x${x.height} vs ${y.width}x${y.height}`};
      const c = document.createElement('canvas'); c.width = x.width; c.height = x.height; const g = c.getContext('2d');
      g.drawImage(x, 0, 0); const dx = g.getImageData(0, 0, c.width, c.height).data; g.clearRect(0, 0, c.width, c.height); g.drawImage(y, 0, 0); const dy = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0; for (let i = 0; i < dx.length; i += 4) if (dx[i] !== dy[i] || dx[i + 1] !== dy[i + 1] || dx[i + 2] !== dy[i + 2]) n++;
      return {same:n === 0, why:n + ' px differ'};
    }, [shots[0].toString('base64'), shots[1].toString('base64')]);
    await cmp.ctx.close(); diffs.push(name + ': ' + res.why); check(R, 'pixel-identical vs dash-orig: ' + name, res.same, res.why);
  }
  check(R, 'no page errors anywhere', allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
} catch(e){ console.error(e); R.push({name:'harness crashed: ' + e.message, ok:false}); }
finally { await browser.close(); port.server.close(); orig.server.close();
  const bad = R.filter(x => !x.ok); console.log(`\n${R.length - bad.length}/${R.length} passed`); if (bad.length) process.exitCode = 1; }
