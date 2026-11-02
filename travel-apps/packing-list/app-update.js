"use strict";
// Standalone app: bypass Pages' cached HTML on resume without interrupting unfinished forms.
(function(){
  var RELOAD_KEY="ta-app-update-reload";
  function assets(doc){return Array.prototype.slice.call(doc.querySelectorAll("script[src],link[rel='stylesheet'][href]")).map(function(node){
    var path=node.getAttribute("src") || node.getAttribute("href") || "";
    try { return new URL(path, location.href).href; } catch(e){ return path; }
  }).filter(function(href){return href && href.indexOf("://cdn.jsdelivr.net/")<0 && href.indexOf("fonts.googleapis.com")<0 && href.indexOf("fonts.gstatic.com")<0;}).join("|");}
  var loaded=assets(document),checking=false,pending=false,lastCheck=0;
  function reload(force){
    try { if (!force && sessionStorage.getItem(RELOAD_KEY)==="1") return; sessionStorage.setItem(RELOAD_KEY,"1"); } catch(e){ if (!force) return; }
    var url=new URL(location.href);url.searchParams.set("app-update",String(Date.now()));location.replace(url.href);
  }
  function notice(){
    if(pending)return;pending=true;
    // Forms autosave on input; storage errors or an active operation must remain visible.
    if(!document.querySelector("form,.sheet-bg,textarea,.undotoast") && !document.querySelector("button:disabled")){reload();return;}
    var box=el("aside","panel gen-actions");box.id="packing-update";box.setAttribute("role","status");box.appendChild(el("span",null,"An app update is ready. Your unfinished changes stay on this device."));
    var button=generatorButton("Load update",function(){if(/Draft could not be saved/.test(document.body.textContent)){box.firstChild.textContent="Your draft could not be saved. Keep this page open until storage is available.";return;}reload(true);});box.appendChild(button);document.querySelector(".wrap").insertBefore(box,document.querySelector("#view"));
  }
  function check(){
    if(checking || pending || document.hidden || Date.now()-lastCheck<30000)return;checking=true;lastCheck=Date.now();
    var url=new URL("index.html",location.href);url.searchParams.set("app-check",String(lastCheck));
    fetch(url.href,{cache:"no-store"}).then(function(response){if(!response.ok)throw new Error("Update unavailable");return response.text();}).then(function(html){var doc=new DOMParser().parseFromString(html,"text/html");if(doc.title!=="Packing List" || !doc.querySelector("#view"))return;if(assets(doc)===loaded){try{sessionStorage.removeItem(RELOAD_KEY);}catch(e){}return;}notice();}).catch(function(){}).then(function(){checking=false;});
  }
  window.addEventListener("pageshow",check);document.addEventListener("visibilitychange",check);window.addEventListener("online",check);setInterval(check,60000);
})();
