// In-app packing: Pack (live checklist) / Adjust (setup) views, quick add, Always bring, row X and quantity steppers.
import http from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname,extname} from 'node:path';import {fileURLToPath} from 'node:url';
let pw;try{pw=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');}catch{console.log('SKIP: playwright not installed');process.exit(0);}
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),server=http.createServer(async(req,res)=>{let path=req.url.split('?')[0];if(path.endsWith('/'))path+='index.html';try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)] || 'application/octet-stream');res.end(await readFile(join(root,path)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=process.env.PACKING_BASE_URL || `http://127.0.0.1:${server.address().port}/packing-list/`,browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}),p=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
p.on('pageerror',e=>errors.push(e.message));
function assert(value,message){if(!value)throw new Error(message);}
const count=()=>p.textContent('#pk-count');
const state=()=>p.evaluate(()=>refineLoad(route().t));
const progress=()=>p.evaluate(()=>db.doc('trip/'+route().t.id+'/pack_meta/progress').get().then(s=>s.exists ? s.data().checked:{}));
let step='start';
try{
  await p.goto(base+'?test=1');await p.waitForSelector('#view');await p.waitForFunction(()=>typeof refineReview==='function');
  await p.evaluate(async()=>{var t={id:'PACK-1',name:'Pack test',where:'Phoenix',start:'2026-12-01',end:'2026-12-04'},s=refineNewState(t,{climate:'mild',workout:true}),r=refineEvaluate(s,generatorPrefs(),[]);await db.doc('trips/'+t.id).set(t);await refinePersist(t,s,r);});

  // Opens on Pack with progress, sections and quick add.
  step='Opens on Pack with progress, sections and quick add.';
  await p.goto(base+'?test=1#PACK-1');await p.waitForSelector('#pk-count');
  assert(await p.getAttribute('#pm-pack','aria-selected')==='true' && await p.isHidden('.adjust-view'),'existing list should open on Pack');
  const total=await p.locator('.pack-row').count();assert(total>20,'pack rows missing');
  assert((await count())==='0 of '+total+' packed','progress line wrong: '+await count());
  assert(await p.locator('.pack-section h3 .pack-count').count()>=5,'section counts missing');

  // Tap to pack: count, bar, row moves to the bottom of its section, saved by stable item id.
  step='Tap to pack: count, bar, row moves to the bottom of its section, saved by stable item id.';
  const first=p.locator('.pack-section').nth(1),firstLabel=await first.locator('.pack-row .pack-label').first().textContent();
  await first.locator('.pack-row').first().click();
  assert((await count())==='1 of '+total+' packed','count after one check: '+await count());
  assert(await first.locator('.pack-row').last().textContent()===firstLabel && await first.locator('.pack-row.packed').count()===1,'packed row should move to the bottom, dimmed');
  assert(Number(await p.getAttribute('.pack-bar','aria-valuenow'))===1,'progress bar not updated');
  await p.waitForTimeout(500);let saved=await progress();assert(Object.keys(saved).length===1 && /^(pack|wear):/.test(Object.keys(saved)[0]),'progress not saved by item id');
  // Before leaving checks count too.
  step='Before leaving checks count too.';
  await p.locator('.pack-section').last().locator('.pack-row').first().click();assert((await count())==='2 of '+total+' packed','Before leaving check not counted');
  await p.waitForTimeout(500);saved=await progress();assert(Object.keys(saved).some(k=>k.startsWith('depart:')),'Before leaving key missing');

  // Checks survive reload and recalculation.
  step='Checks survive reload and recalculation.';
  await p.reload();await p.waitForSelector('#pk-count');await p.waitForFunction(()=>/^2 of/.test(document.querySelector('#pk-count').textContent));
  await p.click('#pm-adjust');assert(await p.isVisible('#rr-export') && await p.isHidden('.pack-view'),'Adjust should show trip plan and export');
  await p.click('button[aria-label="Packing"]');await p.selectOption('#rf-packing','extra');await p.click('button:has-text("Apply & recalculate")');await p.waitForSelector('.sheet-bg',{state:'detached'});
  await p.click('#pm-pack');assert(/^2 of/.test(await count()),'checks lost after recalculation: '+await count());
  // The chosen mode sticks for this trip.
  step='The chosen mode sticks for this trip.';
  await p.click('#pm-adjust');await p.reload();await p.waitForSelector('#rr-export');assert(await p.getAttribute('#pm-adjust','aria-selected')==='true','mode not remembered');await p.click('#pm-pack');

  // Uncheck all + Undo.
  step='Uncheck all + Undo.';
  await p.click('#pk-reset');assert((await count())==='0 of '+(await p.locator('.pack-row').count())+' packed','uncheck all failed');
  await p.click('.pack-progress button:has-text("Undo")');assert(/^2 of/.test(await count()),'undo uncheck failed');

  // Quick add: several at once, guessed sections, quantities, duplicates skipped.
  step='Quick add: several at once, guessed sections, quantities, duplicates skipped.';
  await p.fill('#pa-multi','Camera\nSunscreen x2\n2 Swim trunks\nSocks');await p.click('.pack-progress button:has-text("Add items")');
  await p.waitForFunction(()=>Object.values(refineLoad(route().t).overrides.added).length===3);
  let st=await state(),added=Object.values(st.overrides.added),by=Object.fromEntries(added.map(x=>[x.label,x]));
  assert(by['Camera'] && by['Camera'].section==='Personal bag & day gear','Camera section: '+JSON.stringify(by['Camera']));
  assert(by['Sunscreen'] && by['Sunscreen'].quantity===2 && /toiletries/i.test(by['Sunscreen'].section),'Sunscreen: '+JSON.stringify(by['Sunscreen']));
  assert(by['Swim trunks'] && by['Swim trunks'].quantity===2 && by['Swim trunks'].section==='Clothing','Swim trunks: '+JSON.stringify(by['Swim trunks']));
  assert(/already on the list: Socks/i.test(await p.textContent('.refine-changes')),'duplicate not reported');
  assert(await p.locator('.pack-row:has-text("Sunscreen ×2")').count()===1,'added item not in Pack view');
  // Per-section field: Enter adds and keeps focus for the next one.
  step='Per-section field: Enter adds and keeps focus for the next one.';
  const clothing=p.locator('.pack-section:has(h3:text-is("Clothing")) input[data-section]');
  await clothing.fill('Rain hat');await clothing.press('Enter');await p.waitForFunction(()=>Object.values(refineLoad(route().t).overrides.added).some(x=>x.label==='Rain hat' && x.section==='Clothing'));
  assert(await p.evaluate(()=>document.activeElement && document.activeElement.dataset.section==='Clothing'),'section field should keep focus');

  // Always bring: from the add confirmation; goes to every future list in the same section.
  step='Always bring: from the add confirmation; goes to every future list in the same section.';
  await p.fill('#pa-multi','Travel pillow');await p.click('.pack-progress button:has-text("Add items")');await p.waitForSelector('.pack-always input[aria-label="Always bring Travel pillow"]');
  await p.click('.pack-always label:has(input[aria-label="Always bring Travel pillow"])');
  await p.waitForFunction(()=>(generatorPrefs().generatorExtras || []).includes('Travel pillow'));
  assert(await p.evaluate(()=>generatorPrefs().generatorExtraSections['travel-pillow']==='Personal bag & day gear'),'always-bring section not kept');
  assert(await p.evaluate(()=>{var t={id:'X',where:'Denver',start:'2027-01-01',end:'2027-01-03'},r=refineEvaluate(refineNewState(t,{}),generatorPrefs(),[]);var i=r.items.find(x=>x.label==='Travel pillow');return i && i.section==='Personal bag & day gear' && i.required;}),'not on a new list');
  assert(await p.evaluate(()=>{var r=refineEvaluate(refineLoad(route().t),generatorPrefs(),[]);return r.items.filter(x=>/travel pillow/i.test(x.label)).length===1;}),'always item duplicated on this trip');
  // …and back to one-off from the Adjust row.
  step='…and back to one-off from the Adjust row.';
  await p.click('#pm-adjust');const pillow=p.locator('.refine-item:has(.refine-name:has-text("Travel pillow")) input[aria-label="Always bring Travel pillow"]');
  assert(await pillow.isChecked(),'Adjust row should show Always bring on');await p.locator('.refine-item:has(.refine-name:has-text("Travel pillow")) label.pack-always-chip').click();
  await p.waitForFunction(()=>!(generatorPrefs().generatorExtras || []).includes('Travel pillow'));

  // Adjust rows: X removes at once (Undo), −/+ changes quantity, name opens edit.
  step='Adjust rows: X removes at once (Undo), −/+ changes quantity, name opens edit.';
  const towel='pack:snacks';
  await p.locator(`[data-item-id="${towel}"] .row-x`).click();await p.waitForFunction(id=>refineLoad(route().t).overrides.removed[id],towel);
  assert(await p.locator('.sheet-bg').count()===0,'X should not open a sheet for an optional item');
  await p.click('.refine-changes button:has-text("Undo")');await p.waitForFunction(id=>!refineLoad(route().t).overrides.removed[id],towel);
  const socks=p.locator('[data-item-id="pack:socks"]'),before=Number(await socks.locator('.qty-val').textContent());
  await socks.getByRole('button',{name:'More Socks'}).click();await socks.getByRole('button',{name:'More Socks'}).click();
  assert(Number(await socks.locator('.qty-val').textContent())===before+2,'stepper display');
  await p.waitForFunction(n=>{var e=refineLoad(route().t).overrides.edited['pack:socks'];return e && e.quantity===n;},before+2);
  await p.locator('[data-item-id="pack:socks"]').getByRole('button',{name:/^Edit /}).click();await p.waitForSelector('#ri-quantity');assert(Number(await p.inputValue('#ri-quantity'))===before+2,'edit sheet quantity');await p.click('button:has-text("Close")');
  // A critical item's X still explains first.
  step="A critical item's X still explains first.";
  await p.locator('[data-item-id="pack:contacts"] .row-x').click();await p.waitForSelector('.sheet-bg button:has-text("Remove for this trip")');await p.click('button:has-text("Close")');

  // Mobile layout: no horizontal scroll, 44 px targets, both themes, both views.
  step='Mobile layout: no horizontal scroll, 44 px targets, both themes, both views.';
  for(const colorScheme of ['light','dark'])for(const width of [360,390,430]){await p.emulateMedia({colorScheme});await p.setViewportSize({width,height:844});
    for(const view of ['pack','adjust']){await p.click('#pm-'+view);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),view+' overflows at '+width+' '+colorScheme);}
    assert(await p.evaluate(()=>[...document.querySelectorAll('.adjust-view .row-x,.adjust-view .qty-btn')].every(b=>b.getBoundingClientRect().height>=44)),'small targets');}
  await p.click('#pm-pack');assert(await p.evaluate(()=>[...document.querySelectorAll('.pack-row')].every(r=>r.getBoundingClientRect().height>=44)),'pack rows under 44px');
  if(process.env.SHOTS)for(const colorScheme of ['light','dark']){await p.emulateMedia({colorScheme});await p.setViewportSize({width:390,height:844});for(const view of ['pack','adjust']){await p.click('#pm-'+view);await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:process.env.SHOTS+'/'+view+'-'+colorScheme+'.png'});}await p.click('#pm-adjust');await p.locator('.refine-item[data-item-id="pack:socks"]').scrollIntoViewIfNeeded();await p.screenshot({path:process.env.SHOTS+'/adjust-rows-'+colorScheme+'.png'});}
  assert(errors.length===0,'page errors: '+errors.join(' | '));
  console.log('OK: Pack/Adjust views, live progress by stable ids across reload and recalculation, remembered mode, uncheck-all Undo, multi-line and per-section quick add with section guesses and duplicate skip, Always bring to future lists and back, X/Undo, quantity steppers, critical-item guard and mobile layout');
}catch(e){console.error('FAIL at '+step+':',e.message.split('\n')[0]);await p.screenshot({path:process.env.SHOT || '/tmp/pack-ui-fail.png'}).catch(()=>{});process.exitCode=1;}
finally{await browser.close();server.close();}
