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
      return "<div>" + (enml ? '<en-todo checked="' + (i.checked ? "true" : "false") + '"/>' : (i.checked ? "☑" : "☐") + " ") + escHtml(i.label) + "</div>"; }).join(""); }).join("");
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
function packExportSheet(t, options){
  options=options || {};
  var body=options.container || openSheet(options.reviewNode ? "Review & export" : "Export packing list");if(options.reviewNode)body.id="rr-outfitSummary";
  body.appendChild(el("p","muted","Includes every section and item. Exports are separate copies; changes in Notes do not sync back."));
  var keep=el("input");keep.type="checkbox";keep.id="pe-checked";
  var status=el("p","muted");status.setAttribute("role","status");
  var preview=el("textarea");preview.id="pe-preview";preview.readOnly=true;preview.rows=14;preview.style.width="100%";preview.style.fontSize="16px";
  var more=el("details","gen-opt"),moreActions=el("div","gen-actions"),primary=el("div","gen-actions"),buttons={},ready=!options.prepare;
  more.appendChild(el("summary",null,"More export options"));more.appendChild(moreActions);if(!options.data)more.appendChild(fieldEl("Keep packed items checked (otherwise start unchecked)",keep));more.appendChild(fieldEl("Packing list preview",preview));
  var ios=/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform==="MacIntel" && navigator.maxTouchPoints>1);
  function data(){return options.data ? options.data : packExportData(t,keep.checked);}
  function refresh(){var d=data();preview.value=d.title+"\n"+(d.detail ? d.detail+"\n":"")+"\n"+d.groups.map(function(g){return g.title+"\n"+(g.note ? g.note+"\n":"")+g.items.map(function(i){return (i.checked ? "☑":"☐")+" "+i.label;}).join("\n");}).join("\n\n");}
  var help=el("p","gen-note");
  function recordExport(){if(options.onExport)Promise.resolve().then(options.onExport).catch(function(){status.textContent+=" Packing feedback snapshot could not be saved; retry export to capture it.";});}
  function layout(){["enex","copy","md"].forEach(function(k){var b=buttons[k];b.className=k==="enex" ? "btn primary":"btn";(k==="enex" ? primary:moreActions).appendChild(b);});help.textContent="Mac import: download, then use Notes → File → Import to Notes. ENEX does not import directly into iPhone Notes; use formatted copy there.";}
  function button(format,label,cb){var b=generatorButton(label,function(){if(ready && (!options.canExport || options.canExport()))cb();});b.id="pe-"+format;b.disabled=!ready;buttons[format]=b;}
  button("enex","Apple Notes import (Mac .enex)",function(){packExportDownload(t,packExportEnex(data()),"enex","application/octet-stream");status.textContent="File downloaded. On a Mac, use Notes → File → Import to Notes.";recordExport();});
  button("md","Markdown (.md)",function(){packExportDownload(t,packExportMarkdown(data()),"md","text/markdown;charset=utf-8");status.textContent="Markdown file downloaded.";recordExport();});
  button("copy",ios ? "Copy for Apple Notes":"Copy formatted list",function(){var d=data(),pr;try{if(navigator.clipboard && navigator.clipboard.write && typeof ClipboardItem!=="undefined")pr=navigator.clipboard.write([new ClipboardItem({"text/html":new Blob([packExportHtml(d,false)],{type:"text/html"}),"text/plain":new Blob([preview.value],{type:"text/plain"})})]);else if(navigator.clipboard && navigator.clipboard.writeText)pr=navigator.clipboard.writeText(preview.value);else throw new Error("Clipboard unavailable");}catch(e){pr=Promise.reject(e);}pr.then(function(){status.textContent="Copied. Paste into Notes; checkbox symbols may need conversion with Notes’ checklist button.";recordExport();}).catch(function(){more.open=true;preview.focus();preview.select();preview.setSelectionRange(0,preview.value.length);status.textContent="Automatic copy is unavailable. Copy the selected preview below.";});});
  keep.addEventListener("change",refresh);refresh();layout();if(options.warningNode)body.appendChild(options.warningNode);body.appendChild(primary);body.appendChild(help);body.appendChild(status);
  var retry=generatorButton("Retry saving",prepare);retry.hidden=true;body.appendChild(retry);
  if(options.reviewNode)body.appendChild(options.reviewNode);body.appendChild(more);
  function prepare(){ready=false;retry.hidden=true;status.textContent="Saving your confirmed list…";Object.keys(buttons).forEach(function(k){buttons[k].disabled=true;});Promise.resolve().then(options.prepare).then(function(r){if(r==="stale")return;ready=true;status.textContent="Ready to export.";Object.keys(buttons).forEach(function(k){buttons[k].disabled=false;});}).catch(function(){status.textContent="Could not save for export. Check browser storage and retry.";retry.hidden=false;});}
  if(options.prepare)prepare();return body;
}
