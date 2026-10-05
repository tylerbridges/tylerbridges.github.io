"use strict";
// Standalone app: bypass Pages' cached HTML on resume without interrupting unfinished forms.
(function(){
  function assets(doc){return Array.prototype.slice.call(doc.querySelectorAll("script[src],link[rel='stylesheet'][href]")).map(function(node){return node.getAttribute("src") || node.getAttribute("href");}).filter(function(path){return !/^(https?:)?\/\//.test(path);}).join("|");}
  var loaded=assets(document),checking=false,pending=false,lastCheck=0;
  function reload(){var url=new URL(location.href);url.searchParams.set("app-update",String(Date.now()));location.replace(url.href);}
  function notice(){
    if(pending)return;pending=true;
    // Forms autosave on input; storage errors or an active operation must remain visible.
    if(!document.querySelector("form,.sheet-bg,textarea,.undotoast") && !document.querySelector("button:disabled")){reload();return;}
    var box=el("aside","panel gen-actions");box.id="packing-update";box.setAttribute("role","status");box.appendChild(el("span",null,"An app update is ready. Your unfinished changes stay on this device."));
    var button=generatorButton("Load update",function(){if(/Draft could not be saved/.test(document.body.textContent)){box.firstChild.textContent="Your draft could not be saved. Keep this page open until storage is available.";return;}reload();});box.appendChild(button);document.querySelector(".wrap").insertBefore(box,document.querySelector("#view"));
  }
  function check(){
    if(checking || pending || document.hidden || Date.now()-lastCheck<30000)return;checking=true;lastCheck=Date.now();
    var url=new URL("index.html",location.href);url.searchParams.set("app-check",String(lastCheck));
    fetch(url.href,{cache:"no-store"}).then(function(response){if(!response.ok)throw new Error("Update unavailable");return response.text();}).then(function(html){var doc=new DOMParser().parseFromString(html,"text/html");if(doc.title==="Packing List" && doc.querySelector("#view") && assets(doc)!==loaded)notice();}).catch(function(){}).then(function(){checking=false;});
  }
  window.addEventListener("pageshow",check);document.addEventListener("visibilitychange",check);window.addEventListener("online",check);setInterval(check,60000);
})();
