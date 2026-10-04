"use strict";
/* ================= Packing tab =================
   Sections and items saved under trip/<ID>/pack_sections and trip/<ID>/pack_items. */
// The All / Still to pack / Packed filter is remembered on this device (Tyler, Sep 30 2026).
var packUi = {filter:(function(){ try { var v = JSON.parse(localStorage.getItem("tif-pfilter") || "null"); return v === "left" || v === "done" ? v : "all"; } catch(e){ return "all"; } })(), editing:false};
function packData(id){
  if (!PACK[id]){
    PACK[id] = {sections:{}, items:{}, ready:!db};
    if (db){
      var pk = PACK[id], got = 0;
      function done(){ got++; if (got >= 2) pk.ready = true; if (route().t && route().t.id === id && route().tab === "packing") paintPack(); }
      db.collection("trip/" + id + "/pack_sections").onSnapshot(function(sn){ pk.sections = {}; (sn.docs || []).forEach(function(d){ pk.sections[d.id] = clone(d.data()); }); done(); }, function(){});
      db.collection("trip/" + id + "/pack_items").onSnapshot(function(sn){ pk.items = {}; (sn.docs || []).forEach(function(d){ pk.items[d.id] = clone(d.data()); }); done(); }, function(){});
    }
  }
  return PACK[id];
}
var packRoot = null, packTrip = null;
function packView(t){
  packLearning();
  packTrip = t; packRoot = el("div","pack"); packRoot.style.display = "flex"; packRoot.style.flexDirection = "column"; packRoot.style.gap = "12px";
  packData(t.id); paintPack(); return packRoot;
}
function pwrite(coll, id, data){ if (db) packSave(packTrip.id, coll, id, db.doc("trip/" + packTrip.id + "/" + coll + "/" + id).set(data)); }
// Packing saves: a failed write reloads that item from the database so the list shows what's really saved.
function packSave(tid, coll, id, pr){
  return saveNote(pr.then(function(){ return true; }).catch(function(){
    var pk = PACK[tid], key = coll === "pack_items" ? "items" : coll === "pack_sections" ? "sections" : null;
    if (pk && key && db) db.doc("trip/" + tid + "/" + coll + "/" + id).get().then(function(sn){ if (sn.exists) pk[key][id] = clone(sn.data()); else delete pk[key][id]; if (packTrip && packTrip.id === tid) paintPack(); }).catch(function(){});
    showStatus("<strong>Not saved.</strong> That packing change was undone. Check your connection and try again."); return false; }), "packing"); }
// "Before leaving" (depart) always sorts last, whatever its stored order (Tyler, Sep 29 2026).
function secSort(a, b){ return (a.depart ? 1 : 0) - (b.depart ? 1 : 0) || a.order - b.order; }
function paintPack(){
  if (!packRoot || !packTrip) return;
  if (packUi.dragging) return;
  var t = packTrip, pk = packData(t.id), ae = document.activeElement, keepId = ae && ae.id;
  packRoot.textContent = "";
  var secs = Object.keys(pk.sections).map(function(k){ var s = pk.sections[k]; return {id:k, title:s.title||"", order:s.order||0, depart:!!s.depart, note:s.note||""}; }).sort(secSort);
  function itemsIn(sid){ return Object.keys(pk.items).map(function(k){ var i = pk.items[k]; return {id:k, label:i.label||"", hint:i.hint||"", section:i.section, order:i.order||0, checked:!!i.checked}; }).filter(function(i){ return i.section === sid; }).sort(function(a,b){ return a.order - b.order; }); }
  var done = 0, total = 0; secs.forEach(function(s){ itemsIn(s.id).forEach(function(i){ total++; if (i.checked) done++; }); });

  var head = el("section","panel");
  var meter = el("div","meter"), mb = el("div","mbar"), fill = el("span"); fill.style.width = total ? Math.round(done / total * 100) + "%" : "0%"; mb.appendChild(fill);
  meter.appendChild(mb); meter.appendChild(el("span","count", done + " / " + total + " packed")); head.appendChild(meter);
  var ctr = el("div","controls bar");
  [["all","All"],["left","Still to pack"],["done","Packed"]].forEach(function(f){ var b = el("button",null,f[1]); b.type = "button"; b.id = "pf-" + f[0]; b.setAttribute("aria-pressed", String(packUi.filter === f[0])); b.addEventListener("click", function(){ packUi.filter = f[0]; lsSet("tif-pfilter", f[0]); paintPack(); }); ctr.appendChild(b); });
  ctr.appendChild(el("span","spacer"));
  // Standalone app: export the full saved list, regardless of the current display filter.
  if (pk.ready && secs.length){ var ex = el("button",null,"Export"); ex.type = "button"; ex.id = "p-export"; ex.addEventListener("click", function(){ packExportSheet(t); }); ctr.appendChild(ex); }
  var ua = null, nChecked = Object.keys(pk.items).filter(function(k){ return pk.items[k].checked; });
  if (nChecked.length && !packUi.editing){ ua = el("button",null,"Uncheck all"); ua.type = "button"; var uArmed = false;
    ua.addEventListener("click", function(){ if (!uArmed){ uArmed = true; ua.textContent = "Uncheck " + nChecked.length + "?"; ua.style.color = "var(--stop)"; ua.style.borderColor = "var(--stop)"; return; }
      var now = Date.now(); nChecked.forEach(function(k){ pk.items[k].checked = false; pk.items[k].at = now; pwrite("pack_items", k, Object.assign({}, pk.items[k])); }); paintPack(); });
  }
  if (db && secs.length){ var rb2 = el("button","linkbtn","Reuse"); rb2.type = "button"; rb2.addEventListener("click", function(){ reuseSheet(t); }); ctr.appendChild(rb2);
    var sv2 = el("button","linkbtn","Save as template"); sv2.type = "button"; sv2.addEventListener("click", function(){ saveTemplateSheet(t); }); ctr.appendChild(sv2); }
  // ✨ Update with Claude moved into the chat bubble as the "Rebuild list" chip (Tyler, Sep 25 2026).
  if (secs.length && !packUi.editing){ var ub = el("button","linkbtn", AI.sample ? "✨ Add more" : "Add more"); ub.type = "button"; ub.addEventListener("click", function(){ packBuilder(t, true); }); ctr.appendChild(ub); }
  if (secs.length){ var eb = el("button",null, packUi.editing ? "Done" : "Edit list"); eb.type = "button"; eb.id = "p-edit"; eb.setAttribute("aria-pressed", String(packUi.editing));
    eb.addEventListener("click", function(){ packUi.editing = !packUi.editing; paintPack(); }); ctr.appendChild(eb); }
  head.appendChild(ctr); packRoot.appendChild(head);

  if (!pk.ready){ packRoot.appendChild(el("p","muted","Loading your list…")); return; }
  packQtyFill(t, pk);
  if (!secs.length){
    var es = el("section","panel"); es.appendChild(el("p",null,"No packing list yet."));
    var ea = el("div","actions"); ea.style.display = "flex"; ea.style.gap = "8px"; ea.style.flexWrap = "wrap";
    // Standalone app: the builder works with or without Claude (rules-only when no API key is set).
    var bb = el("button","btn primary", AI.sample ? "✨ Build my packing list" : "Build my packing list"); bb.type = "button"; bb.addEventListener("click", function(){ packBuilder(t, false); }); ea.appendChild(bb);
    if (db){ var rb = el("button","btn","Reuse a list"); rb.type = "button"; rb.addEventListener("click", function(){ reuseSheet(t); }); ea.appendChild(rb); }
    var tb = el("button","btn","Start with the basics"); tb.type = "button"; tb.addEventListener("click", function(){ addToPack(t, BASIC_PACK, true, {source:"basics"}); }); ea.appendChild(tb);
    es.appendChild(ea); packRoot.appendChild(es);
  }

  secs.forEach(function(sec){
    var list = itemsIn(sec.id), box = el("section","psec" + (sec.depart ? " depart" : ""));
    var sh = el("div","psec-head");
    box.dataset.sid = sec.id;
    // Drag to reorder (Tyler, Sep 29 2026): faint grip at the far left; press and hold, then drag above or below.
    // Before leaving stays pinned last and has no grip.
    if (db && !sec.depart) sh.appendChild(secGrip(box, t, pk));
    var h3 = el("h3","ttext",sec.title || "Untitled"); h3.title = "Tap to rename"; sh.appendChild(h3);
    h3.addEventListener("click", function(){
      var ed = el("input","tedit"); ed.type = "text"; ed.value = sec.title; ed.id = "ps-" + sec.id; ed.setAttribute("aria-label","Section name"); var fin = false;
      function finish(save){ if (fin) return; fin = true; var v = ed.value.trim();
        if (save && v && v !== sec.title){ sec.title = v; h3.textContent = v; pk.sections[sec.id].title = v; pwrite("pack_sections", sec.id, {title:v, order:sec.order, depart:sec.depart, note:sec.note}); }
        sh.replaceChild(h3, ed); }
      ed.addEventListener("blur", function(){ finish(true); });
      ed.addEventListener("keydown", function(ev){ if (ev.key === "Enter"){ ev.preventDefault(); finish(true); } else if (ev.key === "Escape") finish(false); });
      sh.replaceChild(ed, h3); ed.focus();
    });
    var sd = list.filter(function(i){ return i.checked; }).length;
    sh.appendChild(el("span","psec-count", sd + " of " + list.length));
    // Collapse a section (Tyler, Sep 30 2026): chevron at the right; remembered per trip on this device.
    var ckey = "tif-pcol-" + t.id, cset = lsGet(ckey, {}), col = !!cset[sec.id] && !packUi.editing;
    if (col){ box.classList.add("pcol"); var pc = sh.querySelector(".psec-count"); if (pc){ pc.textContent = (sd === list.length && list.length ? "✓ " : "") + sd + " of " + list.length + " packed"; if (sd === list.length && list.length) pc.classList.add("alldone"); } }
    if (!packUi.editing){ var cv = el("button","iconbtn pchev", col ? "▸" : "▾"); cv.type = "button";
      cv.setAttribute("aria-label", (col ? "Expand " : "Collapse ") + (sec.title || "section")); cv.setAttribute("aria-expanded", col ? "false" : "true");
      cv.addEventListener("click", function(){ var c2 = lsGet(ckey, {}); if (c2[sec.id]) delete c2[sec.id]; else c2[sec.id] = 1; lsSet(ckey, c2); paintPack(); });
      sh.appendChild(cv); }
    if (packUi.editing && !sec.depart){
      var si0 = secs.indexOf(sec);
      function smv(dir){ var o = secs[si0 + dir]; if (!o || o.depart) return; var a = sec.order, b = o.order;
        pk.sections[sec.id].order = b; pk.sections[o.id].order = a; paintPack();
        pwrite("pack_sections", sec.id, Object.assign({}, pk.sections[sec.id])); pwrite("pack_sections", o.id, Object.assign({}, pk.sections[o.id])); }
      var su = el("button","iconbtn","↑"); su.type = "button"; su.setAttribute("aria-label","Move section up"); su.addEventListener("click", function(){ smv(-1); });
      var sdn = el("button","iconbtn","↓"); sdn.type = "button"; sdn.setAttribute("aria-label","Move section down"); sdn.addEventListener("click", function(){ smv(1); });
      sh.appendChild(su); sh.appendChild(sdn);
    }
    // Delete a whole section and its items (Tyler, Sep 26 2026). Two taps; shown in Edit list mode.
    if (packUi.editing){ var sdel = el("button","iconbtn danger","Delete"); sdel.type = "button"; sdel.setAttribute("aria-label","Delete section " + (sec.title || "")); 
      sdel.addEventListener("click", function(){ var its = itemsIn(sec.id), sSave = clone(pk.sections[sec.id]), iSave = {};
        its.forEach(function(it){ iSave[it.id] = clone(pk.items[it.id]); });
        undoToast("Section deleted" + (its.length ? " (" + its.length + " item" + (its.length > 1 ? "s" : "") + ")" : ""), function(){
          pk.sections[sec.id] = sSave; if (db) packSave(t.id, "pack_sections", sec.id, db.doc("trip/" + t.id + "/pack_sections/" + sec.id).set(sSave));
          Object.keys(iSave).forEach(function(k){ pk.items[k] = iSave[k]; if (db) packSave(t.id, "pack_items", k, db.doc("trip/" + t.id + "/pack_items/" + k).set(iSave[k])); });
          paintPack(); });
        its.forEach(function(it){ delete pk.items[it.id]; if (db) packSave(t.id, "pack_items", it.id, db.doc("trip/" + t.id + "/pack_items/" + it.id).delete()); });
        delete pk.sections[sec.id]; if (db) packSave(t.id, "pack_sections", sec.id, db.doc("trip/" + t.id + "/pack_sections/" + sec.id).delete());
        paintPack(); });
      sh.appendChild(sdel); }
    box.appendChild(sh);
    if (sec.note && !packUi.editing) box.appendChild(el("div","psec-note",sec.note));
    var ul = el("ul","plist"), shown = 0;
    list.forEach(function(it, idx){
      if (!packUi.editing && ((packUi.filter === "left" && it.checked) || (packUi.filter === "done" && !it.checked))) return;
      shown++; var li = el("li");
      if (packUi.editing){
        var re = el("div","prow-edit"), ni = el("span","prow-name",it.label);
        function mv(dir){ var sw = list[idx + dir]; if (!sw) return; var a = it.order, b = sw.order; pk.items[it.id].order = b; pk.items[sw.id].order = a; paintPack();
          pwrite("pack_items", it.id, Object.assign({}, pk.items[it.id])); pwrite("pack_items", sw.id, Object.assign({}, pk.items[sw.id])); }
        var up = el("button","iconbtn","↑"); up.type = "button"; up.setAttribute("aria-label","Move up"); up.addEventListener("click", function(){ mv(-1); });
        var dn = el("button","iconbtn","↓"); dn.type = "button"; dn.setAttribute("aria-label","Move down"); dn.addEventListener("click", function(){ mv(1); });
        var del = el("button","iconbtn danger","Delete"); del.type = "button"; del.addEventListener("click", function(){ var iv = clone(pk.items[it.id]); delete pk.items[it.id]; paintPack(); if (db) db.doc("trip/" + t.id + "/pack_items/" + it.id).delete().catch(function(){});
          undoToast("Item deleted", function(){ pk.items[it.id] = iv; paintPack(); if (db) db.doc("trip/" + t.id + "/pack_items/" + it.id).set(iv).catch(function(){}); }); });
        re.appendChild(ni); re.appendChild(up); re.appendChild(dn); re.appendChild(del); li.appendChild(re);
      } else {
        var lab = el("label","pitem"), cb = el("input"); cb.type = "checkbox"; cb.id = "pc-" + it.id; cb.checked = it.checked;
        cb.addEventListener("change", function(){ pk.items[it.id].checked = cb.checked; pk.items[it.id].at = Date.now(); paintPack(); pwrite("pack_items", it.id, Object.assign({}, pk.items[it.id])); });
        var tx = el("span"), nm = el("span","nm ttext",it.label); nm.title = "Tap to edit"; tx.appendChild(nm); if (it.hint) tx.appendChild(el("span","hint",it.hint));
        // Tap the words to edit them in place; tapping away or Enter saves. Only the checkbox packs the item.
        nm.addEventListener("click", function(e){
          e.preventDefault(); e.stopPropagation();
          var ed = el("input","tedit"); ed.type = "text"; ed.value = it.label; ed.id = "pe-" + it.id; ed.setAttribute("aria-label","Edit item");
          var fin = false;
          function finish(save){
            if (fin) return; fin = true;
            var v = ed.value.trim();
            if (save && v && v !== it.label){ it.label = v; nm.textContent = v; pk.items[it.id].label = v; delete pk.items[it.id].auto; pk.items[it.id].at = Date.now(); pwrite("pack_items", it.id, Object.assign({}, pk.items[it.id])); }
            tx.replaceChild(nm, ed);
          }
          ed.addEventListener("click", function(ev){ ev.preventDefault(); ev.stopPropagation(); });
          ed.addEventListener("blur", function(){ finish(true); });
          ed.addEventListener("keydown", function(ev){ if (ev.key === "Enter"){ ev.preventDefault(); finish(true); } else if (ev.key === "Escape") finish(false); });
          tx.replaceChild(ed, nm); ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length);
        });
        lab.appendChild(cb); lab.appendChild(tx); li.appendChild(lab);
        lab.addEventListener("click", function(e){ if (e.target === cb || (e.target.closest && e.target.closest(".tedit"))) return; e.preventDefault(); if (nm.parentNode) nm.click(); });
        // ✕ on every item, every trip (Tyler, Sep 28 2026): one tap removes it; Undo (bottom-left, 5 s) puts it back.
        li.className = "pli"; var px = el("button","iconbtn pdel","✕"); px.type = "button"; px.setAttribute("aria-label","Remove " + it.label);
        px.addEventListener("click", function(e){ e.preventDefault(); e.stopPropagation(); var iv = clone(pk.items[it.id]); delete pk.items[it.id]; paintPack(); if (db) packSave(t.id, "pack_items", it.id, db.doc("trip/" + t.id + "/pack_items/" + it.id).delete());
          undoToast("Item removed", function(){ pk.items[it.id] = iv; paintPack(); if (db) packSave(t.id, "pack_items", it.id, db.doc("trip/" + t.id + "/pack_items/" + it.id).set(iv)); }); });
        li.appendChild(px);
      }
      ul.appendChild(li);
    });
    box.appendChild(ul);
    if (!shown) box.appendChild(el("div","pempty", list.length ? "Nothing here with this filter." : "No items yet."));
    if (!packUi.editing){
      var ar = el("div","paddrow"), ai = el("input"); ai.type = "text"; ai.id = "pa-" + sec.id; ai.placeholder = "+ Add an item";
      var ab = el("button",null,"Add"); ab.type = "button";
      function submit(){ var v = ai.value.trim(); if (!v) return; var ord = list.length ? list[list.length-1].order + 10 : 10, id = "it-" + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
        pk.items[id] = {label:v, hint:"", section:sec.id, order:ord, checked:false, at:Date.now()}; pwrite("pack_items", id, pk.items[id]); paintPack(); var n = document.getElementById("pa-" + sec.id); if (n) n.focus(); }
      ab.addEventListener("click", submit); ai.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); submit(); } });
      ar.appendChild(ai); ar.appendChild(ab); box.appendChild(ar);
    }
    packRoot.appendChild(box);
  });
  if (secs.length){
    var as = el("div","paddrow"); as.style.border = "0"; as.style.background = "transparent"; as.style.padding = "0";
    var si = el("input"); si.type = "text"; si.id = "p-newsec"; si.placeholder = "+ New section";
    var sb = el("button",null,"Add section"); sb.type = "button";
    // New sections go just above the Before leaving section, which always stays last.
    function addSec(){ var v = si.value.trim(); if (!v) return; var body = secs.filter(function(x){ return !x.depart; }), dep = secs.filter(function(x){ return x.depart; })[0];
      var ord = body.length ? body[body.length-1].order + 10 : 10; if (dep && ord >= dep.order) ord = (body.length ? body[body.length-1].order : 0) + (dep.order - (body.length ? body[body.length-1].order : 0)) / 2;
      var id = "sec-" + Date.now().toString(36);
      pk.sections[id] = {title:v, order:ord, depart:false, note:""}; pwrite("pack_sections", id, pk.sections[id]); paintPack(); }
    sb.addEventListener("click", addSec); si.addEventListener("keydown", function(e){ if (e.key === "Enter"){ e.preventDefault(); addSec(); } });
    as.appendChild(si); as.appendChild(sb); packRoot.appendChild(as);
  }
  if (secs.length && !packUi.editing){ var ux = usualExtrasPanel(t); if (ux) packRoot.appendChild(ux); var mb = usualMaybePanel(t); if (mb) packRoot.appendChild(mb); }
  // Uncheck all lives at the very bottom so it's hard to hit by accident (Tyler, Sep 30 2026). Still two taps.
  if (ua){ var uw = el("div","puncheck"); uw.appendChild(ua); packRoot.appendChild(uw); }
  if (keepId){ var k = document.getElementById(keepId); if (k && k !== document.activeElement) k.focus(); }
}

// Press-and-hold grip that drags a whole section; on release the non-depart sections are renumbered 10, 20, 30…
function secGrip(box, t, pk){
  var g = el("span","pgrip","⋮⋮"); g.setAttribute("role","button"); g.setAttribute("aria-label","Hold to reorder sections"); g.title = "Hold half a second, then drag to reorder";
  var timer = null, on = false, pid = null, sy = 0, root = null, grabDy = 0;
  function peers(){ root = box.parentNode; return [].slice.call(root.querySelectorAll(":scope > section.psec")).filter(function(b){ return !b.classList.contains("depart"); }); }
  function noScroll(e){ if (on && e.cancelable) e.preventDefault(); }
  // After a 0.5 s hold every section folds to just its header so the whole list fits on screen; release restores the full view.
  function start(){ root = box.parentNode; on = true; packUi.dragging = true; root.classList.add("reordering"); box.classList.add("pdragging", "ppop"); setTimeout(function(){ box.classList.remove("ppop"); }, 260); document.body.classList.add("pdragbody");
    var r = box.getBoundingClientRect(); grabDy = Math.max(0, Math.min(r.height, sy - r.top)); // keep the held header under the finger after the fold
    var r2 = box.getBoundingClientRect(); window.scrollBy(0, r2.top + grabDy - sy);
  }
  function end(save){ clearTimeout(timer); timer = null; if (!on){ packUi.dragging = false; return; }
    on = false; packUi.dragging = false; root.classList.remove("reordering"); box.classList.remove("pdragging"); document.body.classList.remove("pdragbody");
    if (save){ var n = 0, changed = [];
      peers().forEach(function(x){ n += 10; var id = x.dataset.sid, sc = pk.sections[id]; if (sc && sc.order !== n){ sc.order = n; changed.push(id); } });
      changed.forEach(function(id){ pwrite("pack_sections", id, Object.assign({}, pk.sections[id])); }); }
    paintPack(); var back = root.querySelector('section.psec[data-sid="' + box.dataset.sid + '"]'); if (back && back.scrollIntoView) back.scrollIntoView({block:"nearest"}); }
  function mvH(e){ if (e.pointerId !== pid) return;
    if (!on){ if (Math.abs(e.clientY - sy) > 12){ clearTimeout(timer); timer = null; off(); packUi.dragging = false; } return; }
    e.preventDefault(); var y = e.clientY, list = peers(), i = list.indexOf(box), prev = list[i - 1], next = list[i + 1];
    if (prev){ var r = prev.getBoundingClientRect(); if (y < r.top + r.height / 2){ root.insertBefore(box, prev); return; } }
    if (next){ var r2 = next.getBoundingClientRect(); if (y > r2.top + r2.height / 2){ root.insertBefore(box, next.nextSibling); } }
    if (y < 70) window.scrollBy(0, -12); else if (y > window.innerHeight - 70) window.scrollBy(0, 12); }
  function upH(e){ if (e.pointerId !== pid) return; off(); end(true); }
  function cxH(e){ if (e.pointerId !== pid) return; off(); end(on ? true : false); }
  function off(){ document.removeEventListener("pointermove", mvH); document.removeEventListener("pointerup", upH); document.removeEventListener("pointercancel", cxH); document.removeEventListener("touchmove", noScroll); }
  g.addEventListener("pointerdown", function(e){ if (e.button > 0) return; e.preventDefault(); pid = e.pointerId; sy = e.clientY; packUi.dragging = true;
    off(); document.addEventListener("pointermove", mvH, {passive:false}); document.addEventListener("pointerup", upH); document.addEventListener("pointercancel", cxH); document.addEventListener("touchmove", noScroll, {passive:false});
    timer = setTimeout(start, e.pointerType === "mouse" ? 200 : 500); });
  g.addEventListener("contextmenu", function(e){ e.preventDefault(); });
  return g;
}

/* ================= Quantities (Tyler, Sep 29 2026) =================
   Socks and underwear: 2 per travel day; T-shirts 1 per day; shorts and pants travel days / 2 rounded up. Contacts: 5 x ceil((travel days + 2) / 5) (Packing Learning rule). Shown as "Socks ×14".
   Travel days = every calendar day from start to end. When the list has both a Wear to travel and a Clothing line for the same
   item, Wear to travel shows ×1 and Clothing shows the rest, so the two add up to the total. Auto-filled labels carry auto:true
   so they follow date changes; a label Tyler edits himself (or one with its own number) is left alone. */
function qtyBase(label){ var b = String(label || "").replace(/\s*[×x]\s*\d+\s*$/i, "").replace(/\(\s*\d+[^)]*\)/g, "").replace(/^\s*\d+\s*(pairs?\s*(of\s*)?)?/i, "").trim(); return b.charAt(0).toUpperCase() + b.slice(1); }
function qtyKey(label){
  var s = String(label || "").toLowerCase().replace(/\s*[×x]\s*\d+\s*$/, "").replace(/\(\s*\d+[^)]*\)/g, "").replace(/^\s*\d+\s*(pairs?\s*(of\s*)?)?/, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return s === "sock" || s === "socks" ? "socks" : s === "underwear" ? "underwear" : s === "contact" || s === "contacts" ? "contacts"
    : /^(lulu )?joggers$/.test(s) ? "joggers" : /^(t shirts?|tshirts?|shirts?)$/.test(s) ? "tshirts" : /^(lulu shorts|shorts|pants|pants shorts|pants and shorts)$/.test(s) ? "bottoms" : "";
}
function qtyTotal(t, key){ var d = tripDates(t).length; if (!d) return 0; return key === "contacts" ? 5 * Math.ceil((d + 2) / 5) : key === "tshirts" ? d : key === "bottoms" ? Math.ceil(d / 2) : key === "joggers" ? Math.ceil(Math.ceil(d / 2) / 2) : 2 * d; }
var QTY_SPLIT = {socks:1, underwear:1, tshirts:1};
function qtyName(key, label){ return key === "socks" ? "Socks" : key === "underwear" ? "Underwear" : key === "contacts" ? "Contacts" : qtyBase(label); }
function qtyLabel(t, label){ var k = qtyKey(label), n = k ? qtyTotal(t, k) : 0; return n ? qtyName(k, label) + " ×" + n : label; }
function packQtyFill(t, pk){
  if (!t.start || closing(t)) return;
  var wear = {}, has = {};
  Object.keys(pk.sections).forEach(function(k){ if (/^wear/i.test(pk.sections[k].title || "")) wear[k] = 1; });
  Object.keys(pk.items).forEach(function(k){ var key = qtyKey(pk.items[k].label); if (key && wear[pk.items[k].section]) has[key] = 1; });
  var jog = 0; Object.keys(pk.items).forEach(function(k){ if (qtyKey(pk.items[k].label) === "joggers") jog = qtyTotal(t, "joggers"); });
  Object.keys(pk.items).forEach(function(k){
    var it = pk.items[k], key = qtyKey(it.label); if (!key) return;
    if (/\d/.test(it.label || "") && !it.auto) return;
    var tot = qtyTotal(t, key); if (!tot) return;
    // Cooler trips swap half the shorts for Lulu joggers (Tyler, Sep 29 2026).
    if (key === "bottoms" && jog && /shorts/i.test(it.label || "")) tot = Math.max(1, tot - jog);
    var n = key === "contacts" ? tot : wear[it.section] ? 1 : QTY_SPLIT[key] && has[key] ? Math.max(1, tot - 1) : tot, lab = qtyName(key, it.label) + " ×" + n;
    if (it.label === lab && it.auto) return;
    it.label = lab; it.auto = true; it.at = Date.now(); pwrite("pack_items", k, Object.assign({}, it));
  });
}

/* ================= Usual extras =================
   Items Tyler normally brings that the starter lists and ✨ builder may not include (taken from his Wyoming list,
   Sep 25 2026). Stored at meta/packing.extras so they can change without a republish; USUAL_EXTRAS is the default.
   A collapsed panel under the packing list shows the ones not already on this trip's list, to add one or all. */
var USUAL_EXTRAS = [
  {title:"Wear to travel", items:["Sweatshirt / hoodie", "Hat", "Brooks running shoes"]},
  {title:"Clothing", items:["T-shirts", "Lulu shorts", "Dirty clothes bag"]},
  {title:"Personal bag & day gear", items:["Small collapsible backpack", "Kindle", "Water bottle", "Snacks", "AirPods", "Anker battery pack", "USB-C hub ×2","USB-C cord ×2","Toothbrush charging cable", "Garmin", "Garmin charger", "WHOOP charger", "Hotspot", "Belkin charging pad", "Glasses", "Costa sunglasses", "Eye drops", "Ibuprofen", "Dryer / washing sheets", "Extra phone case"]},
  {title:"Toiletries", items:["Contacts", "Toothbrush", "Toothpaste", "Lip balm", "Deodorant", "Shampoo", "Body wash", "Hairbrush", "Hair product", "Face wash", "Razor", "Shaving cream", "Aftershave", "Nail clippers", "Tweezers", "Zyrtec", "Prep H", "Ziploc bags", "Wrinkle release"]}
];
// Maybe items (Tyler, Sep 29 2026): offered as tap-to-add chips with the condition that makes them relevant. Stored at meta/packing.maybe.
var USUAL_MAYBE = [
  {tag:"formal", title:"Formal wear", when:"formal, funeral or wedding trips", items:["Dress shoes", "Dress socks ×1", "White shirt ×1", "Undershirt ×1", "Extra tie or pocket square", "Lint roller"]},
  {tag:"water", title:"Clothing", when:"there's a pool or beach", items:["Swimsuit"]},
  {tag:"rain", title:"Personal bag & day gear", when:"rain in the forecast", items:["Rain jacket / umbrella"]},
  {tag:"cold", title:"Clothing", when:"cold weather (below about 40°F)", items:["Light packable puffer jacket", "Lulu joggers", "Gloves", "Beanie", "Thermal base layers"]},
  {tag:"intl", title:"Personal bag & day gear", when:"international trips", items:["Passport", "Plug adapter"]},
  {tag:"longintl", title:"Personal bag & day gear", when:"long international flights", items:["Neck pillow", "Earplugs", "Eye mask"]},
  {tag:"dinner", title:"Clothing", when:"nice dinners (one per dinner)", items:["Button-up long sleeve shirt ×1"]},
  {tag:"cool", title:"Clothing", when:"cool or rainy weather", items:["Light packable puffer jacket", "Lulu joggers"]},
  {tag:"hike", title:"Clothing", when:"hiking trips", items:["Hiking boots / trail shoes"]},
  {tag:"fish", title:"Gear", when:"fishing trips", items:["Fishing gear", "Fishing license"]},
  {tag:"work", title:"Work", when:"a working trip where you work that day", items:["Work computer", "Monitors ×2", "Monitor cables ×2", "Logitech mouse", "Keyboard", "Mouse pad"]},
  {tag:"laptop", title:"Work", when:"you might need your laptop (no work planned)", items:["Work computer"]}
];
var EXTRAS = null, MAYBE = null;
function normItem(x){ return String(x || "").toLowerCase().replace(/\([^)]*\)/g,"").replace(/\s*[×x]\s*\d+\s*$/,"").replace(/^\s*\d+\s*(x\s*)?/,"").replace(/[^a-z0-9]+/g," ").trim(); }
// Contacts follow the Packing Learning rule: 5 × ceil((travel days + 2) / 5).
function extraLabel(t, label){ return /^contacts$/i.test(label) ? "Contacts ×" + (qtyTotal(t, "contacts") || 5 * Math.ceil((3 + 2) / 5)) : label; }
function usualExtrasPanel(t){
  if (EXTRAS === null && db){ EXTRAS = USUAL_EXTRAS; db.doc("meta/packing").get().then(function(sn){ var o = sn.exists && sn.data(); if (o && (Array.isArray(o.extras) || Array.isArray(o.maybe))){ if (Array.isArray(o.extras)) EXTRAS = o.extras; if (Array.isArray(o.maybe)) MAYBE = o.maybe; paintPack(); } }).catch(function(){}); }
  var src = EXTRAS || USUAL_EXTRAS, pk = packData(t.id), have = {};
  Object.keys(pk.items).forEach(function(k){ have[normItem(pk.items[k].label)] = true; });
  var missing = src.map(function(g){ return {title:g.title, depart:g.depart, items:(g.items || []).filter(function(i){ return !have[normItem(i)]; })}; }).filter(function(g){ return g.items.length; });
  var n = missing.reduce(function(a, g){ return a + g.items.length; }, 0); if (!n) return null;
  // Put each extra in the list's matching section even if it's named a little differently ("Wear to airport").
  var titles = Object.keys(pk.sections).map(function(k){ return pk.sections[k]; });
  missing.forEach(function(g){ var w = normItem(g.title).split(" ").slice(0,2).join(" ");
    var hit = titles.filter(function(sc){ return g.depart ? sc.depart : normItem(sc.title).indexOf(w) === 0; })[0]; if (hit) g.title = hit.title; });
  var d = collapsible("Usual extras · " + n + " not on this list", "ux|" + t.id); d.classList.add("uxp");
  missing.forEach(function(g){ d.appendChild(el("div","sub-k", g.title)); var w = el("div","chipset");
    g.items.forEach(function(i){ var b = el("button","chipchk","+ " + extraLabel(t, i)); b.type = "button";
      b.addEventListener("click", function(){ addToPack(t, [{title:g.title, depart:g.depart, items:[extraLabel(t, i)]}]); }); w.appendChild(b); });
    d.appendChild(w); });
  var all = el("button","btn","Add all " + n); all.type = "button"; all.style.marginTop = "10px";
  all.addEventListener("click", function(){ addToPack(t, missing.map(function(g){ return {title:g.title, depart:g.depart, items:g.items.map(function(i){ return extraLabel(t, i); })}; })); });
  d.appendChild(all); return d;
}
// Maybe panel: items Tyler brings only sometimes, each with the condition, added one at a time.
function usualMaybePanel(t){
  var src = MAYBE || USUAL_MAYBE, pk = packData(t.id), have = {};
  Object.keys(pk.items).forEach(function(k){ have[normItem(pk.items[k].label)] = true; });
  var missing = src.map(function(g){ return {title:g.title, when:g.when, items:(g.items || []).filter(function(i){ return !have[normItem(i)]; })}; }).filter(function(g){ return g.items.length; });
  var n = missing.reduce(function(a, g){ return a + g.items.length; }, 0); if (!n) return null;
  var d = collapsible("Maybe · " + n + " if they apply", "mb|" + t.id); d.classList.add("uxp");
  missing.forEach(function(g){ d.appendChild(el("div","sub-k", "If " + g.when)); var w = el("div","chipset");
    g.items.forEach(function(i){ var b = el("button","chipchk","+ " + i); b.type = "button";
      b.addEventListener("click", function(){ addToPack(t, [{title:g.title, items:[i]}]); }); w.appendChild(b); });
    d.appendChild(w); });
  return d;
}

/* ================= Packing learning (at close-out) =================
   Claude compares the starting list, the final list, never-checked items and Tyler's note, and returns scoped lessons,
   standing rules for the ✨ builder, and changes to the usual extras. Stored in meta/packing (lessons, rules, extras,
   learned[Trip ID]); the packing-learning skill later folds them into Work OS Packing Learning.md. A checkbox left
   unchecked is not proof an item wasn't needed; one-trip changes stay conditional. */
function learnPacking(t, rev, note){
  if (!AI.sample || !db) return;
  var ref = db.doc("meta/packing");
  ref.get().then(function(sn){ var cur = (sn.exists && sn.data()) || {}; if (cur.learned && cur.learned[t.id]) return;
    var days = tripDates(t).length;
    var prompt = "You improve a traveler's future packing lists from one completed trip. Be conservative: an unchecked box is not proof an item was unneeded; one trip's change is a conditional lesson scoped to its conditions, not a universal rule, unless the traveler's note says so.\n\n" +
      "Trip: " + JSON.stringify({name:t.name, where:t.where, dates:t.start + " to " + t.end, travelDays:days, travelers:t.who, bookings:t.segments.map(function(b){ return b.type + ": " + b.label; })}) +
      "\nWhat the starting list was built for: " + (rev.context ? JSON.stringify(rev.context) : "unknown") +
      "\nStarting list (baseline): " + (rev.original ? JSON.stringify(rev.original) : "not saved") + "\nAdded after the baseline: " + JSON.stringify(rev.added || []) + "\nRemoved from the baseline: " + JSON.stringify(rev.removed || []) + "\nFinal list: " + JSON.stringify(rev.final) + "\nNever checked: " + JSON.stringify(rev.unchecked) + "\nTraveler's note: " + JSON.stringify(note || "none") +
      "\nExisting standing rules: " + JSON.stringify(cur.rules || []) + "\nUsual extras: " + JSON.stringify(cur.extras || USUAL_EXTRAS) +
      "\n\nReply with only JSON: {\"lessons\":[{\"lesson\":\"short\",\"scope\":\"general | e.g. cold weather, 7+ nights, hiking, work trip\"}],\"rules\":[\"standing rule for future lists, only if clearly supported\"],\"addExtras\":[{\"title\":\"section\",\"item\":\"item\"}],\"removeExtras\":[\"item\"]}. Use empty arrays when nothing is supported. Never change the Before leaving checklist or the contacts quantity rule. Ignore Before leaving items and \"×N\" count differences. Scope each lesson to the context the baseline was built for (trip type tags, weather, days, luggage), so the same kind of trip gets a more accurate list next time.";
    return AI.sample.json(prompt, {}).then(function(r){ r = r || {};
      var lessons = (cur.lessons || []).concat((Array.isArray(r.lessons) ? r.lessons : []).slice(0,8).filter(function(x){ return x && x.lesson; }).map(function(x){ return {trip:t.id, at:isoToday(), lesson:String(x.lesson).slice(0,200), scope:String(x.scope || "general").slice(0,60)}; })).slice(-60);
      var rules = (cur.rules || []).slice(); (Array.isArray(r.rules) ? r.rules : []).slice(0,5).forEach(function(x){ x = String(x || "").trim().slice(0,200); if (x && rules.indexOf(x) < 0) rules.push(x); }); rules = rules.slice(-25);
      var ex = clone(cur.extras || USUAL_EXTRAS), drop = {}; (Array.isArray(r.removeExtras) ? r.removeExtras : []).forEach(function(i){ drop[normItem(i)] = true; });
      ex.forEach(function(g){ g.items = (g.items || []).filter(function(i){ return !drop[normItem(i)]; }); });
      (Array.isArray(r.addExtras) ? r.addExtras : []).slice(0,8).forEach(function(a){ if (!a || !a.item) return; var g = ex.filter(function(x){ return normItem(x.title) === normItem(a.title || ""); })[0] || ex.filter(function(x){ return !x.depart; })[0]; if (g && !g.items.some(function(i){ return normItem(i) === normItem(a.item); })) g.items.push(String(a.item).slice(0,80)); });
      var learned = Object.assign({}, cur.learned || {}); learned[t.id] = {at:isoToday(), lessons:(r.lessons || []).length, synced:false};
      EXTRAS = ex;
      return ref.set(Object.assign({}, cur, {lessons:lessons, rules:rules, extras:ex, learned:learned, updatedAt:isoToday()}));
    }).then(function(){ return saveTrip(t.id, {closeout:Object.assign({}, (RAW[t.id] && RAW[t.id].closeout) || {}, {packing:"learned"})}, false, true); });
  }).catch(function(){});
}
// Learned rules and recent lessons, for the ✨ packing builder prompt.
var PACK_RULES = null;
function packLearning(){ if (PACK_RULES === null && db){ PACK_RULES = {rules:[], lessons:[]}; db.doc("meta/packing").get().then(function(sn){ var o = sn.exists && sn.data(); if (o) PACK_RULES = {rules:o.rules || [], lessons:(o.lessons || []).slice(-15)}; }).catch(function(){}); } return PACK_RULES || {rules:[], lessons:[]}; }

/* ================= Reuse packing lists =================
   "Reuse a list" copies sections and items (unchecked) from a saved template or another trip's list; items already
   on this list are skipped, and the Before leaving section stays last. "Save as template" stores this list's
   sections and items at templates/<id> {name, groups:[{title, depart, note, items[]}], at}. */
function packGroups(id){
  var pk = packData(id);
  return Object.keys(pk.sections).map(function(k){ var sc = pk.sections[k]; return {id:k, title:sc.title || "Other", depart:!!sc.depart, note:sc.note || "", order:sc.order || 0}; })
    .sort(secSort)
    .map(function(sc){ return {title:sc.title, depart:sc.depart, note:sc.note, items:Object.keys(pk.items).map(function(k){ return pk.items[k]; }).filter(function(i){ return i.section === sc.id; }).sort(function(a,b){ return (a.order||0) - (b.order||0); }).map(function(i){ return i.label; }).filter(Boolean)}; })
    .filter(function(g){ return g.items.length; });
}
function whenReady(id, cb, tries){ var pk = packData(id); if (pk.ready || (tries || 0) > 40) return cb(); setTimeout(function(){ whenReady(id, cb, (tries || 0) + 1); }, 150); }
var TEMPLATES = null;
function loadTemplates(cb){
  if (TEMPLATES) return cb(TEMPLATES);
  var done = false;
  db.collection("templates").onSnapshot(function(sn){ TEMPLATES = {}; ((sn && sn.docs) || []).forEach(function(d){ TEMPLATES[d.id] = clone(d.data()); }); if (!done){ done = true; cb(TEMPLATES); } }, function(){ if (!done){ done = true; cb({}); } });
}
function reuseSheet(t){
  var body = openSheet("Reuse a packing list"), tbox = el("div","actlist"), rbox = el("div","actlist");
  body.appendChild(el("h2","k","Templates")); body.appendChild(tbox); body.appendChild(el("h2","k","From a trip")); body.appendChild(rbox);
  function use(groups, label){ var n = addToPack(t, groups, false, {source:"reuse", from:label}); closeSheet(); showStatus(""); if (!n) showStatus("<strong>Nothing new.</strong> Everything from " + escHtml(label) + " is already on this list."); }
  thinking(tbox, "Loading…");
  loadTemplates(function(T){ tbox.textContent = "";
    var ids = Object.keys(T).sort(function(a,b){ return (T[b].at || 0) - (T[a].at || 0); });
    if (!ids.length) tbox.appendChild(el("p","muted","No templates yet."));
    ids.forEach(function(id){ var x = T[id], n = (x.groups || []).reduce(function(a, g){ return a + (g.items || []).length; }, 0);
      var row = el("div","sugg"), tx = el("span"); tx.appendChild(el("b",null, x.name || "Template")); tx.appendChild(el("span","muted", n + " items")); row.appendChild(tx);
      var acts = el("div"); acts.style.display = "flex"; acts.style.gap = "6px";
      var u = el("button","btn primary","Use"); u.type = "button"; u.addEventListener("click", function(){ use(x.groups || [], x.name || "that template"); });
      var d = el("button","clearbtn","Delete"); d.type = "button";
      d.addEventListener("click", function(){ var tv = clone(TEMPLATES[id]), nx = row.nextSibling, par = row.parentNode; delete TEMPLATES[id]; row.remove(); db.doc("templates/" + id).delete().catch(function(){});
        undoToast("Template deleted", function(){ TEMPLATES[id] = tv; par.insertBefore(row, nx); db.doc("templates/" + id).set(tv).catch(function(){}); }); });
      acts.appendChild(u); acts.appendChild(d); row.appendChild(acts); tbox.appendChild(row); });
  });
  var others = Object.keys(TRIPS).filter(function(id){ return id !== t.id; });
  thinking(rbox, "Loading…"); var left = others.length, found = 0;
  if (!left) rbox.textContent = "";
  others.forEach(function(id){ whenReady(id, function(){
    var g = packGroups(id), n = g.reduce(function(a, x){ return a + x.items.length; }, 0);
    if (n){ if (!found) rbox.textContent = ""; found++; var o = TRIPS[id], b = el("button","act"); b.type = "button"; var tx = el("span");
      tx.appendChild(el("b",null,o.name)); tx.appendChild(el("span","muted", (o.start ? fmt(o.start) + " – " + fmt(o.end) + " · " : "") + n + " items")); b.appendChild(tx);
      b.addEventListener("click", function(){ use(g, o.name); }); rbox.appendChild(b); }
    if (!--left && !found){ rbox.textContent = ""; rbox.appendChild(el("p","muted","No other trip has a packing list yet.")); }
  }); });
}
function saveTemplateSheet(t){
  var body = openSheet("Save as template"), g = packGroups(t.id);
  var name = inp("tpl-name","text", t.name + " list", "Template name"); body.appendChild(fieldEl("Name", name));
  var sv = el("button","btn primary","Save template"); sv.type = "button"; var msg = el("p","muted"); body.appendChild(sv); body.appendChild(msg);
  sv.addEventListener("click", function(){ var n = name.value.trim(); if (!n){ name.focus(); return; }
    var id = "tpl-" + Date.now().toString(36), rec = {name:n.slice(0,80), groups:g, at:Date.now(), from:t.id};
    sv.disabled = true; db.doc("templates/" + id).set(rec).then(function(){ if (TEMPLATES) TEMPLATES[id] = rec; closeSheet(); })
      .catch(function(){ sv.disabled = false; msg.textContent = "Couldn't save the template. Try again."; }); });
  setTimeout(function(){ name.focus(); name.select(); }, 0);
}

/* Close out a trip (dashboard #<ID>.closeout) is not part of this app: it archives the trip and checks tasks,
   bookings and costs. learnPacking() above is kept so a packing review screen can call it later. */

/* Before leaving is one-to-one with the list (Tyler, Sep 29 2026): a departure check appears only when the item it checks is on the
   list. Wallet, ID and the bags always appear. */
var LEAVING_RULES = [
  [/^(glasses)\b/i, "Glasses packed?"], [/sunglasses/i, "Sunglasses packed?"], [/water bottle/i, "Water bottle empty?"],
  [/charger|usb-c|\bhub\b|\bcord\b|\bcable/i, "Chargers packed?"], [/^work computer(?:\s*[×x]\s*\d+)?$/i, "Work computer packed?"], [/^personal laptop(?:\s*[×x]\s*\d+)?$/i, "Personal laptop packed?"],
  [/^monitors?(?:\s*[×x]\s*\d+)?$/i, "Both work monitors packed?"], [/^monitor cables?/i, "Monitor cables / power packed?"]
];
function leavingFor(groups, checked){
  var labels = []; groups.forEach(function(g){ if (g.depart || /^before leaving$/i.test(g.title || "")) return; (g.items || []).forEach(function(x){ labels.push({t:g.title || "", x:String(x)}); }); });
  var out = ["Grab wallet", "ID in wallet?"];
  // Standalone app: removing toiletries or the liquids bag also removes its departure check.
  if (labels.some(function(l){ return /toiletr/i.test(l.t); })) out.push("Toiletries packed?");
  if (labels.some(function(l){ return /liquids.*(?:quart|bag)/i.test(l.x); })) out.push("Liquids bag packed? (travel-size, quart bag)");
  LEAVING_RULES.forEach(function(r){ if (labels.some(function(l){ return r[0].test(l.x); }) && out.indexOf(r[1]) < 0) out.push(r[1]); });
  out.push("Grab personal bag", checked ? "Grab checked bag" : "Grab carry-on");
  return out;
}
var BASIC_PACK = [
  {title:"Wear to travel", items:["Shirt","Sweatshirt / hoodie","Pants","Underwear","Socks","Brooks running shoes"]},
  {title:"Clothing", items:["T-shirts","Underwear","Socks"]},
  {title:"Personal bag & day gear", items:["USB-C cord ×2"]}
];
// Merge a list of {title, items[], depart?, note?} into the trip's packing list: match sections by name, skip items already there.
function packContext(t, ctx){ ctx = ctx || {}; var d = tripDates(t).length;
  return {source:ctx.source || "manual", tags:ctx.tags || [], picked:ctx.picked || [], luggage:ctx.luggage || "carryon", notes:ctx.notes || "", from:ctx.from || "",
    where:t.where || "", start:t.start || "", end:t.end || "", travelDays:d, nights:d ? d - 1 : 0, kind:t.kind || t.type || ""}; }
function alwaysGroups(groups){
  var seen = {}; groups.forEach(function(g){ (g.items || []).forEach(function(i){ seen[normItem(i)] = true; }); });
  return (EXTRAS || USUAL_EXTRAS).filter(function(g){ return !g.depart; }).map(function(g){ return {title:g.title, depart:g.depart, items:(g.items || []).filter(function(i){ return !seen[normItem(i)]; })}; }).filter(function(g){ return g.items.length; });
}
function addToPack(t, groups, always, ctx){
  function pw(coll, id, data){ if (db) packSave(t.id, coll, id, db.doc("trip/" + t.id + "/" + coll + "/" + id).set(data)); }
  var pk = packData(t.id), n = 0, now = Date.now(), wasEmpty = !Object.keys(pk.items).length;
  // A brand-new list also gets everything Tyler said he always brings (Sep 29 2026).
  if (always && wasEmpty){ groups = groups.concat(alwaysGroups(groups));
    if (!groups.some(function(g){ return g.depart; })) groups = groups.concat([{title:"Before leaving", depart:true, note:"Departure checks, not packing. Run it last.", items:leavingFor(groups, false)}]); }
  // First fill of a list: keep the full starting list (always items included) plus the trip context it was built for,
  // so close-out can compare baseline vs final and learn (Tyler, Sep 30 2026).
  if (wasEmpty && db) db.doc("trip/" + t.id + "/pack_meta/original").set({at:now, context:packContext(t, ctx), groups:groups.map(function(g){ return {title:g.title, depart:!!g.depart, items:(g.items || []).map(function(i){ return extraLabel(t, i); })}; })}).catch(function(){});
  var secs = Object.keys(pk.sections).map(function(k){ return {id:k, title:(pk.sections[k].title || "").toLowerCase(), order:pk.sections[k].order || 0}; });
  var maxOrd = Object.keys(pk.sections).reduce(function(a, k){ var sc = pk.sections[k]; return sc.depart ? a : Math.max(a, sc.order || 0); }, 0);
  groups.forEach(function(g, gi){
    var key = String(g.title || "Other").toLowerCase(), found = secs.filter(function(s){ return s.title === key; })[0], sid;
    if (found) sid = found.id;
    else { sid = "sec-" + now.toString(36) + gi; maxOrd += 10; var depart = !!g.depart || /before leaving/.test(key);
      pk.sections[sid] = {title:String(g.title || "Other"), order: depart ? 9999 : maxOrd, depart:depart, note:g.note || (depart ? "Departure checks, not packing. Run it last." : "")};
      pw("pack_sections", sid, pk.sections[sid]); secs.push({id:sid, title:key, order:maxOrd}); }
    var have = {}, ord = 0;
    Object.keys(pk.items).forEach(function(k){ var it = pk.items[k]; if (it.section === sid){ have[(it.label || "").toLowerCase()] = true; ord = Math.max(ord, it.order || 0); } });
    (g.items || []).forEach(function(label, ii){
      label = String(label).trim(); var ql = qtyLabel(t, label); if (!label) return; var isQ = ql !== label; label = ql; if (have[label.toLowerCase()]) return;
      var id = "it-" + now.toString(36) + gi + "x" + ii; ord += 10; have[label.toLowerCase()] = true;
      pk.items[id] = {label:label, hint:"", section:sid, order:ord, checked:false, at:now}; if (isQ) pk.items[id].auto = true; pw("pack_items", id, pk.items[id]); n++;
    });
  });
  if (packTrip && packTrip.id === t.id) paintPack();
  return n;
}
function packBuilder(t, updating){
  var body = openSheet(updating ? "Update packing list" : "Build my packing list");
  var nights = t.start && t.end ? Math.max(1, Math.round((pd(t.end) - pd(t.start)) / 86400000)) : 3;
  var f = el("form","form");
  var n = inp("pb-nights","number", nights); n.min = "1"; f.appendChild(fieldEl("Nights", n));
  var acts = [["hike","Hiking"],["fish","Fishing"],["water","Pool or beach"],["formal","Formal event (funeral, wedding)"],["work","Working on the trip (a work day)"],["laptop","Might need my laptop (no work planned)"],["cold","Cold weather (below ~40°F)"],["cool","Cool weather (40-60°F)"],["hot","Hot weather (above ~85°F)"],["rain","Rain in the forecast"],["intl","International"],["longintl","Long international flight"],["dinner","Nice dinners (button-up shirt)"],["fly","Flying (not driving)"]];
  var box = el("div","chipset"); acts.forEach(function(a){ var l = el("label","chipchk"), c = el("input"); c.type = "checkbox"; c.value = a[1]; c.dataset.tag = a[0]; c.id = "pb-" + a[0]; l.appendChild(c); l.appendChild(el("span",null,a[1])); box.appendChild(l); });
  var fs = el("div","field"); fs.appendChild(el("label",null,"What's the trip like?")); fs.appendChild(box); f.appendChild(fs);
  var bag = sel("pb-bag", [["carryon","Carry-on + personal bag (usual)"],["checked","Checked bag + personal bag (holidays, bringing stuff back)"]], "carryon"); f.appendChild(fieldEl("Luggage", bag));
  var extra = el("textarea"); extra.id = "pb-extra"; extra.rows = 2; extra.placeholder = "Anything else? e.g. a wedding, a baby, ski gear";
  f.appendChild(fieldEl("Anything else", extra));
  var go = el("button","btn primary","Make my list"); go.type = "submit"; f.appendChild(go);
  body.appendChild(f);
  f.addEventListener("submit", function(e){
    e.preventDefault();
    var pickedEls = [].slice.call(box.querySelectorAll("input:checked")), picked = pickedEls.map(function(c){ return c.value; }), tags = pickedEls.map(function(c){ return c.dataset.tag; });
    var pk = packData(t.id), existing = Object.keys(pk.items).map(function(k){ return pk.items[k].label; }), days = tripDates(t).length || (+n.value + 1);
    var prompt = "Draft a packing list for this trip.\nTrip: " + tripBrief(t) + "\nNights: " + n.value + "\nTrip includes: " + (picked.join(", ") || "nothing special") + "\nLuggage: " + bag.options[bag.selectedIndex].text + "\nNotes: " + (extra.value.trim() || "none") +
      (existing.length ? "\nAlready on the list (do not repeat these): " + existing.join("; ") : "") +
      "\n\nRules: one distinct item per line, never bundle two items; give one definite quantity where it matters, choosing the higher number, written as \"Item ×N\" (\"Shirts ×5\", not \"4-5 shirts\"); socks and underwear are 2 per travel day (\"Socks ×\" + 2 x travel days) and contacts are 5 x ceil((travel days + 2) / 5) (\"Contacts ×10\"), where this trip has " + days + " travel days; keep it realistic for the nights and activities." +
      "\nHe travels with a carry-on plus a personal bag; assume carry-on plus personal bag; if Luggage says checked, he takes one larger checked bag instead of the carry-on. In hot weather (above about 85F) lean toward shorts and fewer pants. Liquids are travel-size in one quart bag. He always wears Brooks running shoes and brings no other shoes unless they are listed in the separate items; no sleepwear. Already covered separately (do not list these): " + (EXTRAS || USUAL_EXTRAS).map(function(g){ return (g.items || []).join(", "); }).join(", ") + (function(){ var ms = (MAYBE || USUAL_MAYBE).filter(function(g){ return tags.indexOf(g.tag) > -1; }); return ms.length ? ", " + ms.map(function(g){ return g.items.join(", "); }).join(", ") : ""; })() + "." +
      "\nUse these sections when they apply: Wear to travel, Clothing, Personal bag & day gear, Toiletries, Work, Gear. Do not include a Before leaving section." +
      (function(){ var L = packLearning(); return (L.rules.length ? "\nStanding rules learned from past trips (follow them): " + L.rules.join(" | ") : "") + (L.lessons.length ? "\nLessons from past trips (apply only where the scope matches this trip): " + L.lessons.map(function(x){ return x.lesson + " [" + x.scope + "]"; }).join(" | ") : ""); })() +
      '\nReply with only JSON: [{"title":"section name","items":["item", "..."]}]';
    var st = thinking(body, AI.sample ? "Drafting your list…" : "Building your list…");
    // Standalone app: without Claude, the draft comes from the saved preferences (ruleDraft in rules.js).
    (AI.sample ? AI.sample.json(prompt, {onText: function(){ st.textContent = "Almost done…"; }}) : Promise.resolve(ruleDraft(t, tags, bag.value, +n.value, existing))).then(function(arr){
      arr = Array.isArray(arr) ? arr.filter(function(g){ return g && g.title && Array.isArray(g.items); }) : [];
      // The "maybe" items that match what he ticked (Sep 29 2026) are added as-is, not left to the model.
      var seenP = {}; existing.forEach(function(x){ seenP[normItem(x)] = true; }); arr.forEach(function(g){ g.items.forEach(function(x){ seenP[normItem(x)] = true; }); });
      (MAYBE || USUAL_MAYBE).forEach(function(g){ if (tags.indexOf(g.tag) < 0) return; var its = (g.items || []).filter(function(x){ return !seenP[normItem(x)]; }); its.forEach(function(x){ seenP[normItem(x)] = true; }); if (its.length) arr.push({title:g.title, items:its}); });
      if (!updating && !Object.keys(pk.sections).some(function(k){ return pk.sections[k].depart; })) arr.push({title:"Before leaving", depart:true, items:leavingFor(arr.concat(alwaysGroups(arr)), bag.value === "checked")});
      body.textContent = "";
      if (!arr.length){ body.appendChild(el("p",null,"Nothing new to add.")); return; }
      var picks = [];
      arr.forEach(function(g, gi){
        var sec = el("div","checks"); sec.appendChild(el("h2","k", g.title));
        g.items.forEach(function(it, ii){ var l = el("label"), c = el("input"); c.type = "checkbox"; c.checked = true; c.id = "pbi-" + gi + "-" + ii; l.appendChild(c); l.appendChild(el("span",null,String(it))); sec.appendChild(l); picks.push({g:gi, label:String(it), c:c}); });
        body.appendChild(sec);
      });
      var add = el("button","btn primary","Add to packing list"); add.type = "button";
      add.addEventListener("click", function(){
        var groups = arr.map(function(g, gi){ return {title:g.title, depart:g.depart, items: picks.filter(function(p){ return p.g === gi && p.c.checked; }).map(function(p){ return p.label; })}; });
        addToPack(t, groups, !updating, {source:"builder", tags:tags, picked:picked, luggage:bag.value, notes:extra.value.trim().slice(0,300)}); closeSheet();
      });
      body.appendChild(add);
    }).catch(function(e2){ var msg = sampleError(e2); body.textContent = ""; if (msg) body.appendChild(el("p","errline",msg)); });
  });
}
