// Account sync (account-sync.js) against a fake Supabase connector (mock-claude.js): first sync both ways,
// edits/deletes on either side, echo suppression, conflicts, header rules, permission and error states.
import {serve, seed, open, PW, DIRS, check} from './lib.mjs';
const R = [], data = await seed(DIRS.port), browser = await PW.chromium.launch(), {server, url} = await serve(DIRS.port);
const A = 'trip/APP-2026-12-01/', W = 'trip/REPLACEMENT-2026-09-19/';
const supa = {
  'trips/APP-2026-12-01': {name:'App-only trip', where:'Denver, CO', start:'2026-12-01', end:'2026-12-04', status:'Researching', packingDeleted:false, days:[], bookings:{}},
  [A + 'pack_sections/s0']: {title:'Clothing', order:20, depart:false, note:''},
  [A + 'pack_items/i0']: {label:'T-shirts ×3', section:'s0', order:10, checked:false},
  [A + 'pack_items/i1']: {label:'Socks ×7', section:'s0', order:20, checked:false},
  'trips/OLD-2026-11-03': {name:'Old copy', start:'2026-11-03', end:'2026-11-08', packingDeleted:true, replacedBy:'X'},
  'trip/OLD-2026-11-03/pack_items/z': {label:'Should stay in the account only', section:'q'},
  'meta/packing': {rules:['Account rule'], lessons:[], learned:{}, updatedAt:'2026-11-02'}
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function settle(page, test, ms = 15000){ const t0 = Date.now(); while (Date.now() - t0 < ms){ if (await page.evaluate(test)) return true; await wait(200); } return false; }
const okState = () => window.__acctSync && window.__acctSync.state === 'ok' && !window.__acctSync.busy;

{ const {page, errors} = await open(browser, url, data, {supa});
  await page.goto(url + '#REPLACEMENT-2026-09-19.packing');
  check(R, 'first sync completes', await settle(page, okState));
  let rows = await page.evaluate(() => window.__mockSupa.rows());
  check(R, 'Dashboard list pushed to account', await settle(page, () => Object.entries(window.__mockSupa.rows()).some(([k, r]) => k.startsWith('trip/REPLACEMENT-2026-09-19/pack_items/') && r.data.label === 'Toothbrush' && Object.entries(window.__mockSupa.rows()).some(([k2, r2]) => k2.startsWith('trip/REPLACEMENT-2026-09-19/pack_items/') && r2.data.hint === 'Buy in Jackson')), 12000));
  check(R, 'Dashboard trip header pushed (name/dates, packing fields)', rows['trips/REPLACEMENT-2026-09-19'] && rows['trips/REPLACEMENT-2026-09-19'].data.name === 'Wyoming Trip' && rows['trips/REPLACEMENT-2026-09-19'].data.packing === true);
  check(R, 'account wins first-sync conflict (meta/packing)', await page.evaluate(() => db.doc('meta/packing').get().then(s => s.data().rules[0])) === 'Account rule');
  check(R, 'account-only trip created in Dashboard', await page.evaluate(() => db.doc('trips/APP-2026-12-01').get().then(s => s.exists && s.data().packing === true && s.data().name === 'App-only trip')));
  check(R, 'account-only trip list pulled', await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i1').get().then(s => s.exists && s.data().label === 'Socks ×7')));
  check(R, 'deleted/replaced account trip not imported', await page.evaluate(() => db.doc('trips/OLD-2026-11-03').get().then(s => !s.exists)) && await page.evaluate(() => db.collection('trip/OLD-2026-11-03/pack_items').get().then(s => !s.docs.length)));
  check(R, 'replaced trip rows left alone in account', !!(await page.evaluate(() => window.__mockSupa.rows()))['trip/OLD-2026-11-03/pack_items/z']);
  check(R, 'status line on Packing tab', await settle(page, () => /Synced with your packing app/.test(document.querySelector('#packgen').textContent), 4000));

  // No changes → no writes. (Opening an old-style list re-saves it once under new ids; let that sync first.)
  await settle(page, () => document.querySelector('#rr-export') || document.querySelector('#pe-enex'), 8000); await wait(1500); await settle(page, okState);
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  let before = await page.evaluate(() => window.__mockSupa.calls.length);
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  let calls = await page.evaluate(n => window.__mockSupa.calls.slice(n), before);
  check(R, 'idle sync makes no writes', !calls.some(c => /ta_sync_write/.test(c)), (await page.evaluate(() => JSON.stringify(window.__acctSync.lastPush))));
  check(R, 'idle sync pulls nothing', (await page.evaluate(() => window.__acctSync.stats.pulled)) === 0);

  // Account edit → Dashboard.
  await page.evaluate(() => window.__mockSupa.edit('trip/APP-2026-12-01/pack_items/i0', {label:'T-shirts ×4', section:'s0', order:10, checked:true}));
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  check(R, 'account edit reaches Dashboard', await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i0').get().then(s => s.data().label === 'T-shirts ×4' && s.data().checked === true)));

  // Dashboard edit → account (scheduled by the edit itself).
  await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i5').set({label:'Hoodie', section:'s0', order:50, checked:true}));
  check(R, 'Dashboard edit reaches account automatically', await settle(page, () => { const r = window.__mockSupa.rows()['trip/APP-2026-12-01/pack_items/i5']; return r && r.data.label === 'Hoodie'; }, 12000));

  // Deletes both ways.
  await settle(page, okState);
  await page.evaluate(() => window.__mockSupa.edit('trip/APP-2026-12-01/pack_items/i1', null));
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  check(R, 'account delete removes Dashboard doc', await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i1').get().then(s => !s.exists)));
  await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i5').delete());
  check(R, 'Dashboard delete removes account row', await settle(page, () => !window.__mockSupa.rows()['trip/APP-2026-12-01/pack_items/i5'], 12000));

  // Both changed → account wins.
  await settle(page, okState);
  await page.evaluate(() => window.__acctSync.allowed = false);
  await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i0').set({label:'Dashboard version', section:'s0', order:10}));
  await page.evaluate(() => window.__mockSupa.edit('trip/APP-2026-12-01/pack_items/i0', {label:'Account version', section:'s0', order:10}));
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  check(R, 'conflict: account wins', await page.evaluate(() => db.doc('trip/APP-2026-12-01/pack_items/i0').get().then(s => s.data().label === 'Account version')));

  // Account packing fields come back; Dashboard keeps its name.
  await page.evaluate(() => window.__mockSupa.edit('trips/REPLACEMENT-2026-09-19', Object.assign({}, window.__mockSupa.rows()['trips/REPLACEMENT-2026-09-19'].data, {name:'Renamed in app', generatorSetup:{bag:'checked'}})));
  await page.evaluate(() => AccountSync.sync()); await settle(page, okState);
  const t = await page.evaluate(() => db.doc('trips/REPLACEMENT-2026-09-19').get().then(s => s.data()));
  check(R, 'account packing fields applied to Dashboard trip', t.generatorSetup && t.generatorSetup.bag === 'checked');
  check(R, 'Dashboard keeps its own trip name', t.name === 'Wyoming Trip');
  check(R, 'Dashboard name pushed back to account', await settle(page, () => window.__mockSupa.rows()['trips/REPLACEMENT-2026-09-19'].data.name === 'Wyoming Trip', 5000));
  check(R, 'no page errors (sync session)', errors.length === 0, errors.join(' | '));
  await page.context().close(); }

// Not yet allowed: button, no calls until tapped.
{ const {page, errors} = await open(browser, url, data, {supa, mock:{supaPerm:'prompt'}});
  await page.goto(url + '#REPLACEMENT-2026-09-19.packing'); await wait(3000);
  const txt = await page.textContent('#packgen');
  check(R, 'prompt state offers Turn on sync', /Turn on sync/.test(txt), txt.slice(0, 120));
  check(R, 'no connector calls before the tap', (await page.evaluate(() => window.__mockSupa.calls.length)) === 0);
  await page.click('#packgen .acct-sync button');
  check(R, 'tap runs the sync', await settle(page, okState));
  check(R, 'no page errors (prompt session)', errors.length === 0, errors.join(' | '));
  await page.context().close(); }

// Connector missing.
{ const {page, errors} = await open(browser, url, data, {supa, mock:{supaError:'server_not_connected'}});
  await page.goto(url + '#REPLACEMENT-2026-09-19.packing');
  await settle(page, () => window.__acctSync && window.__acctSync.state === 'error');
  check(R, 'server_not_connected explains how to add Supabase', await settle(page, () => /Add Supabase in claude\.ai Settings/.test(document.querySelector('#packgen').textContent), 4000));
  check(R, 'no page errors (error session)', errors.length === 0, errors.join(' | '));
  await page.context().close(); }

// No connector in this view (e.g. a viewer without mcp): nothing breaks.
{ const {page, errors} = await open(browser, url, data);
  await page.goto(url + '#REPLACEMENT-2026-09-19.packing'); await wait(2500);
  check(R, 'no mcp → packing tab still works', /Packing list/.test(await page.textContent('main')) && errors.length === 0, errors.join(' | '));
  await page.context().close(); }

await browser.close(); server.close();
const failed = R.filter(r => !r.ok); console.log(`\n${R.length - failed.length}/${R.length} passed`); process.exit(failed.length ? 1 : 0);
