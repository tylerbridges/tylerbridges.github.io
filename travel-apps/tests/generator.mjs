import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const context = vm.createContext({document:{getElementById(){ return null; },addEventListener(){}},window:{addEventListener(){}},localStorage:{getItem(){ return null; }},console,setTimeout,clearTimeout});
for (const file of ["shared/core.js","packing-list/preferences.js","packing-list/packing.js","packing-list/generator.js","packing-list/export.js"]){ vm.runInContext(readFileSync(new URL("../" + file,import.meta.url),"utf8"),context); }
const trip = {id:"TEST",name:"Test",start:"2026-10-08",end:"2026-10-14"};
const setup = {mode:"fly",bag:"carryon",climate:"mild",laundry:"none",work:"none",formal:0,dinners:0};
function build(changes={},prefs=context.PACK_PREFS,t=trip){ return context.generatorBuild(t,{...setup,...changes},prefs); }
function group(d,title){ return d.groups.find(g=>g.title===title)?.items || []; }
let d=build();assert(group(d,"Dry toiletries").includes("Toothbrush"));assert(group(d,"Liquid toiletries").includes("Toothpaste"));assert(!d.groups.flatMap(g=>g.items).some(x=>/Liquids.*(?:quart|bag)/i.test(x)));assert.equal(group(d,"Before leaving").filter(x=>x==="Toiletries packed?").length,1);
assert(group(d,"Clothing").includes("Socks ×13")); assert(group(d,"Wear to travel").includes("Socks ×1"));
assert(group(d,"Clothing").includes("T-shirts ×6")); assert(group(d,"Dry toiletries").includes("Contacts ×10"));
assert(group(d,"Clothing").includes("Lulu shorts ×4")); assert(!group(d,"Clothing").some(i=>/joggers/.test(i)));
d=build({climate:"cool"}); assert(group(d,"Clothing").includes("Lulu shorts ×2")); assert(group(d,"Clothing").includes("Lulu joggers ×2"));
d=build({rain:true,climate:"hot"}); assert(group(d,"Clothing").includes("Lulu joggers ×2"));
d=build({climate:"cold"}); for (const item of ["Gloves","Beanie","Thermal base layers"]){ assert(group(d,"Clothing").includes(item)); }
d=build({climate:"hot"}); assert(!group(d,"Clothing").some(i=>/joggers|jacket|pants/i.test(i)));
d=build({laundry:"cycle",interval:2}); assert(group(d,"Clothing").includes("Socks ×5")); assert(group(d,"Dry toiletries").includes("Contacts ×10"));
d=build({formal:2,dinners:3}); assert(group(d,"Formal wear").includes("White shirt ×2")); assert(group(d,"Formal wear").includes("Dress socks ×2")); assert(group(d,"Clothing").includes("Button-up long sleeve shirt ×3"));
d=build({work:"work",bag:"checked"}); assert(group(d,"Work").includes("Work computer")); assert(group(d,"Before leaving").includes("Grab checked bag")); assert(!group(d,"Before leaving").includes("Grab carry-on"));
d=build({intl:true,longintl:true,mode:"drive"}); assert(!group(d,"Personal bag & day gear").includes("Neck pillow"));
d=build({intl:true,longintl:true}); assert(group(d,"Personal bag & day gear").includes("Neck pillow"));
d=build({},context.PACK_PREFS,{...trip,end:trip.start}); assert(!group(d,"Clothing").some(i=>/×0/.test(i))); assert(group(d,"Dry toiletries").includes("Contacts ×5"));
const prefs=JSON.parse(JSON.stringify(context.PACK_PREFS)); prefs.extras=prefs.extras.map(g=>({...g,items:g.items.filter(i=>i!=="Kindle")})); prefs.generatorExtras=["Medicine pouch"];
d=build({extra:"Medicine pouch\nCamera ×2"},prefs); assert(!group(d,"Personal bag & day gear").includes("Kindle")); assert.equal(group(d,"Personal bag & day gear").filter(i=>i==="Medicine pouch").length,1); assert(group(d,"Personal bag & day gear").includes("Camera ×2"));
assert(!context.leavingFor([{title:"Work",items:["Work computer charger"]}],false).includes("Work computer packed?"));
assert(!context.leavingFor([{title:"Work",items:["Monitor cables ×2"]}],false).includes("Both work monitors packed?"));
assert(!context.leavingFor([{title:"Toiletries",items:["Toothbrush"]}],false).some(i=>/Liquids bag/.test(i)));
assert(!context.leavingFor([{title:"Toiletries",items:[]}],false).some(i=>/Toiletries packed/.test(i)));
assert.equal(d.groups.at(-1).title,"Before leaving");
assert.throws(()=>build({},prefs,{...trip,start:"",end:""}),/valid trip dates/);
const html=context.packExportHtml({title:"Test",detail:"",groups:[{title:"Clothing",items:[{label:"A & <B>",checked:false}]}]},true);
assert(!html.includes("<h1>")); assert(html.includes('<en-todo checked="false"/> A &amp; &lt;B&gt;'));
console.log("OK: packing quantities, weather, laundry, events, saved preferences, departure dependencies, and Notes export");
