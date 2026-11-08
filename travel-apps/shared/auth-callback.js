"use strict";
/* Magic-link / email-confirm landing page. Trip pages use the URL hash
   (#KAUAI-2026-11-03), so sign-in returns here with ?code= instead of
   overwriting that hash. The code verifier lives in this origin's storage. */
(function(){
  var cfg = window.TRAVEL_SUPABASE || {};
  var key = String(cfg.key || cfg.anonKey || "").trim();
  var status = document.getElementById("auth-status");
  var back = document.getElementById("auth-back");
  function say(text){ if (status) status.textContent = text; }
  function dest(){
    var fallback = "packing-list/";
    try {
      var saved = sessionStorage.getItem("ta-auth-return");
      if (!saved) return fallback;
      var u = new URL(saved, location.origin);
      if (u.origin !== location.origin) return fallback;
      if (/\/auth\.html$/.test(u.pathname)) return fallback;
      return u.pathname + u.search + u.hash;
    } catch(e){ return fallback; }
  }
  if (back) back.href = dest();
  function go(){ location.replace(dest()); }
  var params = new URLSearchParams(location.search);
  var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var err = params.get("error_description") || hash.get("error_description");
  if (err){ say(err.replace(/\+/g, " ")); return; }
  if (!window.supabase || !window.supabase.createClient || !cfg.url || !key || key.indexOf("sb_secret_") === 0){
    say("Supabase isn't configured in this copy of the app.");
    return;
  }
  // detectSessionInUrl exchanges ?code= once. A second exchangeCodeForSession call invalidates it.
  var client = window.supabase.createClient(String(cfg.url).replace(/\/$/, ""), key, {
    auth: {flowType: "pkce", detectSessionInUrl: true, persistSession: true}
  });
  var done = false;
  function finish(session){
    if (done || !session) return;
    done = true;
    say("Signed in. Opening the app…");
    go();
  }
  client.auth.onAuthStateChange(function(event, session){ if (session) finish(session); });
  client.auth.getSession().then(function(res){
    var session = res && res.data && res.data.session;
    if (session) finish(session);
    else setTimeout(function(){ if (!done) say(params.get("code") ? "This sign-in link didn't finish. Request a new one from the app." : "This sign-in link didn't include a code. Request a new one from the app."); }, 1500);
  }).catch(function(e){
    var msg = e && e.message || "";
    if (/code verifier/i.test(msg)) say("Open the sign-in link in the same browser that requested it.");
    else say(msg || "Couldn't finish sign-in. Request a new link.");
  });
})();
