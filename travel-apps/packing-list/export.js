"use strict";
// Standalone app: portable packing exports; ENEX carries checkbox items for Notes' Mac importer.
function packExportData(t, keepChecked){
  var pk = packData(t.id);
  function line(s){ return String(s || "").replace(/[\r\n]+/g, " "); }
  return {title:line(t.name || t.where || "Trip") + " — Packing List",
    detail:[line(t.where), t.start ? line(t.start) + (t.end && t.end !== t.start ? " – " + line(t.end) : "") : ""].filter(Boolean).join(" · "),
    groups:Object.keys(pk.sections).map(function(id){ var s = pk.sections[id]; return {id:id, title:line(s.title || "Untitled"), note:line(s.note), order:s.order || 0, depart:!!s.depart}; }).sort(secSort)
      .map(function(s){ return {title:s.title, note:s.note, items:Object.keys(pk.items).map(function(id){ return pk.items[id]; })
        .filter(function(i){ return i.section === s.id && i.label; }).sort(function(a,b){ return (a.order || 0) - (b.order || 0); })
        .map(function(i){ return {label:line(i.label), checked:!!keepChecked && !!i.checked}; })}; })};
}
function packExportMarkdown(data){
  function md(s){ return s.replace(/([\\`*{}\[\]<>_#!|])/g, "\\$1"); }
  return "# " + md(data.title) + "\n\n" + (data.detail ? md(data.detail) + "\n\n" : "") + data.groups.map(function(g){
    return "## " + md(g.title) + "\n\n" + (g.note ? md(g.note) + "\n\n" : "") + g.items.map(function(i){ return "- [" + (i.checked ? "x" : " ") + "] " + md(i.label); }).join("\n"); }).join("\n\n") + "\n";
}
function packExportHtml(data, enml){
  return (enml ? "" : "<h1>" + escHtml(data.title) + "</h1>") + (data.detail ? "<p>" + escHtml(data.detail) + "</p>" : "") + data.groups.map(function(g){
    return "<h2>" + escHtml(g.title) + "</h2>" + (g.note ? "<p>" + escHtml(g.note) + "</p>" : "") + g.items.map(function(i){
      return "<div>" + (enml ? '<en-todo checked="' + (i.checked ? "true" : "false") + '"/>' : (i.checked ? "☑" : "☐")) + " " + escHtml(i.label) + "</div>"; }).join(""); }).join("");
}
function packExportEnex(data){
  var enml = '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>' + packExportHtml(data, true) + "</en-note>";
  return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">\n<en-export export-date="' + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "") + '" application="Travel Apps" version="1.0"><note><title>' + escHtml(data.title) + '</title><content><![CDATA[' + enml + ']]></content></note></en-export>\n';
}
function packExportDownload(t, content, extension, type){
  var url = URL.createObjectURL(new Blob([content], {type:type})), a = document.createElement("a");
  a.href = url; a.download = slug(t.name || t.where || "trip").toLowerCase() + "-packing-list." + extension;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(url); }, 60000);
}
function packExportSheet(t){
  var body = openSheet("Export packing list");
  body.appendChild(el("p","muted","Includes all sections and items, even when your list is filtered or collapsed. Exports are separate copies; changes in Notes do not sync back."));
  var keep = el("input"); keep.type = "checkbox"; keep.id = "pe-checked";
  body.appendChild(fieldEl("Keep packed items checked (otherwise start unchecked)", keep));
  var info = el("p","muted"); info.textContent = "Download the Apple Notes file and import it into Notes for section headings and native checklist items. On Mac: File → Import to Notes. Formatted copy is an alternative for pasting; use Notes’ checklist button if the checkbox symbols remain plain text."; body.appendChild(info);
  var actions = el("div","actions"); actions.style.display = "flex"; actions.style.flexWrap = "wrap"; actions.style.gap = "8px";
  var status = el("p","muted"); status.setAttribute("role","status");
  var preview = el("textarea"); preview.id = "pe-preview"; preview.readOnly = true; preview.rows = 14; preview.style.width = "100%"; preview.style.fontSize = "16px";
  function data(){ return packExportData(t, keep.checked); }
  function refresh(){ var d = data(); preview.value = d.title + "\n" + (d.detail ? d.detail + "\n" : "") + "\n" + d.groups.map(function(g){ return g.title + "\n" + (g.note ? g.note + "\n" : "") + g.items.map(function(i){ return (i.checked ? "☑" : "☐") + " " + i.label; }).join("\n"); }).join("\n\n"); }
  function button(label, id, cb){ var b = el("button",null,label); b.type = "button"; b.id = id; b.addEventListener("click", cb); actions.appendChild(b); }
  button("Apple Notes file (.enex)", "pe-enex", function(){ packExportDownload(t, packExportEnex(data()), "enex", "application/xml"); });
  button("Markdown (.md)", "pe-md", function(){ packExportDownload(t, packExportMarkdown(data()), "md", "text/markdown;charset=utf-8"); });
  button("Copy formatted list", "pe-copy", function(){
    var d = data(), pr;
    try {
      if (navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem !== "undefined") pr = navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([packExportHtml(d, false)], {type:"text/html"}), "text/plain":new Blob([preview.value], {type:"text/plain"})})]);
      else if (navigator.clipboard && navigator.clipboard.writeText) pr = navigator.clipboard.writeText(preview.value);
      else throw new Error("Clipboard unavailable");
    } catch(e){ pr = Promise.reject(e); }
    pr.then(function(){ status.textContent = "Copied. Paste into Notes; checkbox symbols may need conversion with Notes’ checklist button."; }).catch(function(){ preview.focus(); preview.select(); preview.setSelectionRange(0, preview.value.length); status.textContent = "Automatic copy is unavailable. Copy the selected preview below."; });
  });
  keep.addEventListener("change", refresh); refresh(); body.appendChild(actions); body.appendChild(status); body.appendChild(fieldEl("Packing list preview", preview));
}
