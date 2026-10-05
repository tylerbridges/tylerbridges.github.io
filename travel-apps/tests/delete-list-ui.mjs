// Production deletion flow, exercised with sandbox-prefixed storage only.
import http from 'node:http';import {readFile} from 'node:fs/promises';import {join,dirname,extname} from 'node:path';import {fileURLToPath} from 'node:url';
let pw;try{pw=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');}catch{console.log('SKIP: playwright not installed');process.exit(0);}
const root=join(dirname(fileURLToPath(import.meta.url)),'..'),server=http.createServer(async(req,res)=>{let path=req.url.split('?')[0];if(path.endsWith('/'))path+='index.html';try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)] || 'application/octet-stream');res.end(await readFile(join(root,path)));}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/packing-list/`,browser=await pw.chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined}),p=await browser.newPage({viewport:{width:390,height:844}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
function assert(value,message){if(!value)throw new Error(message);}
try{
  // Real touch input: the first tap must work immediately after a swipe, without settling delays.
  const touch=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await touch.goto(base+'?test=1');await touch.waitForFunction(()=>READY);
  await touch.evaluate(async()=>{PACK_TEST_MODE=false;await db.doc('trips/TOUCH').set({name:'Touch trip',where:'Test',start:'2026-10-08',end:'2026-10-12'});render();});
  await touch.locator('.packing-list-front').waitFor();const touchBox=await touch.locator('.packing-list-front').boundingBox(),cdp=await touch.context().newCDPSession(touch),y=touchBox.y+30,x=touchBox.x+touchBox.width-100;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-110,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const deleteX=touchBox.x+touchBox.width-44;
  assert(await touch.evaluate(({x,y})=>document.elementFromPoint(x,y).classList.contains('packing-list-delete'),{x:deleteX,y}),'revealed Delete is covered by the sliding row');
  await touch.locator('.packing-list-delete').evaluate(button=>{
    button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:10,pointerType:'touch',isPrimary:true,clientX:350,clientY:100}));button.dispatchEvent(new PointerEvent('pointermove',{pointerId:10,pointerType:'touch',clientX:350,clientY:125}));button.dispatchEvent(new PointerEvent('pointerup',{pointerId:10,pointerType:'touch',clientX:350,clientY:125}));
    button.dispatchEvent(new PointerEvent('pointerdown',{pointerId:11,pointerType:'touch',isPrimary:true,clientX:350,clientY:100}));button.dispatchEvent(new PointerEvent('pointercancel',{pointerId:11,pointerType:'touch'}));button.dispatchEvent(new PointerEvent('pointerup',{pointerId:11,pointerType:'touch',clientX:350,clientY:100}));
  });assert(await touch.evaluate(()=>!TRIPS.TOUCH.packingDeleted),'drag/canceled touch deleted the list');
  await touch.evaluate(()=>{const original=generatorDeleteList;window.touchDeleteCalls=0;generatorDeleteList=function(t){touchDeleteCalls++;return original(t);};});
  await touch.touchscreen.tap(deleteX,y);await touch.waitForFunction(()=>TRIPS.TOUCH.packingDeleted,{},{timeout:2000});
  assert(await touch.evaluate(()=>touchDeleteCalls===1),'tap activated deletion twice');await touch.getByRole('button',{name:'Undo',exact:true}).tap();await touch.waitForFunction(()=>!TRIPS.TOUCH.packingDeleted);
  assert(await touch.locator('.packing-delete-toast').count()===0,'Undo did not dismiss toast');
  await touch.getByRole('button',{name:'List actions for Touch trip',exact:true}).tap();await touch.getByRole('button',{name:'Delete packing list Touch trip',exact:true}).tap();
  await touch.locator('.packing-delete-toast').waitFor();assert(await touch.locator('.packing-delete-toast').evaluate(x=>{const b=x.getBoundingClientRect();return b.bottom>innerHeight-70 && getComputedStyle(x).position==='fixed';}),'Undo not minimal at bottom');
  await touch.waitForTimeout(4000);assert(await touch.locator('.packing-delete-toast').count()===1,'Undo disappeared before five seconds');await touch.waitForSelector('.packing-delete-toast',{state:'detached',timeout:2000});assert(await touch.evaluate(()=>GEN_DELETED_LIST===null),'expired Undo retained snapshot');await touch.close();
  await p.goto(base+'?test=1');await p.waitForFunction(()=>READY);
  await p.evaluate(async()=>{
    localStorage.setItem('ta:trips/REAL',JSON.stringify({name:'Real data'}));
    const trip={name:'Vacation',where:'Phoenix',start:'2026-10-08',end:'2026-10-12',bookings:{hotel:{label:'Hotel'}},days:[{label:'Day 1'}]};
    await db.doc('trips/ONE').set(trip);await db.doc('trips/ONE2').set({...trip,name:'Other trip'});
    await db.doc('trip/ONE/pack_sections/clothing').set({label:'Clothing',order:0});await db.doc('trip/ONE/pack_items/shirt').set({label:'Shirt',section:'clothing',order:0});
    await db.doc('trip/ONE/itinerary/main').set({days:['Keep itinerary']});await db.doc('trip/ONE2/pack_items/keep').set({label:'Keep'});
    await db.doc('meta/packingLearning').set({version:1,keep:true});await db.doc('meta/packingFormDrafts/'+encodeURIComponent('edit:ONE:shirt')).set({keep:'draft'});
    // Only switch the home view; Store, direct helpers and drafts keep their sandbox prefix.
    PACK_TEST_MODE=false;location.hash='';
  });await p.waitForTimeout(100);await p.evaluate(()=>render());
  const first=p.locator('.packing-list-row').filter({has:p.getByRole('heading',{name:'Vacation',exact:true})});
  assert(await first.locator('.packing-list-delete').isHidden(),'Delete exposed without reveal');
  // Vertical motion must not reveal actions or cancel page scrolling.
  await first.locator('.packing-list-front').evaluate(front=>{front.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,isPrimary:true,button:0,clientX:200,clientY:100,bubbles:true}));front.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,isPrimary:true,clientX:195,clientY:150,bubbles:true}));front.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,isPrimary:true,clientX:195,clientY:150,bubbles:true}));});
  assert(await first.locator('.packing-list-delete').isHidden(),'vertical scroll revealed Delete');
  const box=await first.locator('.packing-list-front').boundingBox();await p.mouse.move(box.x+box.width-90,box.y+30);await p.mouse.down();await p.mouse.move(box.x+box.width-200,box.y+30,{steps:8});await p.mouse.up();
  assert(await first.locator('.packing-list-delete').isVisible(),'swipe failed to reveal');assert(new URL(p.url()).hash==='','swipe opened list');await p.waitForTimeout(450);
  await first.locator('.packing-list-delete').click();await p.waitForFunction(()=>TRIPS.ONE.packingDeleted);assert(await p.locator('.packing-list-row').count()===1,'deleted list still visible');
  assert(await p.evaluate(()=>{const d=Store.exportAll();return !Object.keys(d).some(k=>k.startsWith('trip/ONE/pack_')) && !!d['trip/ONE/itinerary/main'] && !!d['trip/ONE2/pack_items/keep'] && d['trips/ONE'].bookings.hotel.label==='Hotel' && d['meta/packingLearning'].keep && localStorage.getItem('ta:trips/REAL')==='{"name":"Real data"}';}),'deleted unrelated data');
  await p.evaluate(async()=>{const trip=Store.exportAll()['trips/ONE'];trip.bookings.hotel.label='Updated hotel';await db.doc('trips/ONE').set(trip);});await p.getByRole('button',{name:'Undo',exact:true}).click();await p.waitForFunction(()=>!TRIPS.ONE.packingDeleted);
  assert(await p.evaluate(()=>{const d=Store.exportAll();return d['trip/ONE/pack_items/shirt'].label==='Shirt' && d['trips/ONE'].bookings.hotel.label==='Updated hotel' && !!d['meta/packingFormDrafts/'+encodeURIComponent('edit:ONE:shirt')];}),'Undo lost documents or overwrote shared changes');
  // Desktop/keyboard alternative plus atomic rollback when storage fails partway through removal.
  await p.getByRole('button',{name:'List actions for Vacation',exact:true}).click();await p.keyboard.press('Escape');assert(await first.locator('.packing-list-delete').isHidden(),'Escape did not close actions');
  await p.evaluate(()=>{window.originalRemove=Storage.prototype.removeItem;let n=0;Storage.prototype.removeItem=function(key){if(key.startsWith('packing-test:ta:trip/ONE/pack_') && ++n===2)throw new Error('Injected failure');return originalRemove.call(this,key);};});
  await p.getByRole('button',{name:'List actions for Vacation',exact:true}).click();await first.locator('.packing-list-delete').click();await p.waitForSelector('.packing-list-row .gen-error:not(:empty)');assert(await p.evaluate(()=>!TRIPS.ONE.packingDeleted && !!Store.exportAll()['trip/ONE/pack_items/shirt']),'failed deletion lost data');await p.evaluate(()=>Storage.prototype.removeItem=originalRemove);
  await p.getByRole('link',{name:/Vacation/}).click(); // Close revealed row first.
  await p.getByRole('link',{name:/Vacation/}).click();await p.waitForSelector('.gen-review');
  // Delay an export adapter write: in-list deletion must wait, then remove its output.
  await p.evaluate(()=>{const original=generatorSaveDraft;generatorSaveDraft=function(){const args=arguments;return new Promise((resolve,reject)=>{window.releaseDeleteSave=()=>original.apply(null,args).then(resolve,reject);});};render();});await p.waitForFunction(()=>typeof releaseDeleteSave==='function');await p.getByRole('button',{name:'Delete list',exact:true}).click();assert(await p.getByRole('button',{name:'Delete list',exact:true}).isDisabled(),'Delete not guarded while waiting');await p.evaluate(()=>releaseDeleteSave());await p.waitForFunction(()=>TRIPS.ONE.packingDeleted && location.hash==='');
  assert(await p.evaluate(()=>!Object.keys(Store.exportAll()).some(k=>k.startsWith('trip/ONE/pack_'))),'pending export resurrected deleted list');await p.evaluate(()=>location.hash='ONE');await p.getByRole('heading',{name:'Packing list deleted',exact:true}).waitFor();assert(await p.locator('#rr-export').count()===0,'old link regenerated deleted list');
  await p.reload();await p.waitForFunction(()=>READY);await p.getByRole('heading',{name:'Packing list deleted',exact:true}).waitFor();await p.getByRole('link',{name:'Generate a packing list',exact:true}).click();await p.waitForSelector('#rs-where');assert(await p.inputValue('#rs-where')==='Phoenix','intentional regeneration lost trip details');await p.getByRole('button',{name:'Generate my list',exact:true}).click();await p.waitForSelector('#rr-export');await p.waitForFunction(()=>!document.querySelector('#pe-enex').disabled);assert(await p.evaluate(()=>!TRIPS.ONE.packingDeleted && !!Store.exportAll()['trip/ONE/pack_meta/refinement'] && Store.exportAll()['trips/ONE'].bookings.hotel.label==='Updated hotel'),'intentional regeneration failed or lost itinerary data');
  for(const width of [360,390,430])for(const colorScheme of ['light','dark']){await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme});await p.evaluate(()=>{PACK_TEST_MODE=false;location.hash='';render();});await p.waitForTimeout(50);assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home overflow');}
  assert(errors.length===0,errors.join('; '));console.log('OK: first-touch deletion, canceled gestures, five-second bottom Undo, swipe, keyboard actions, in-list Delete, Undo, shared-data preservation, storage rollback, export race, deleted-link guard and mobile layout');
}catch(e){console.error(e.stack || e.message);process.exitCode=1;}finally{await browser.close();server.close();}
