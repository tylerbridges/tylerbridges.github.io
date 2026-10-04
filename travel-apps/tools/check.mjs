// Static checks for the travel apps: JS syntax and that every file the HTML loads exists.
// Run from this folder: node tools/check.mjs
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
function walk(d){ return readdirSync(d).flatMap(n => { const p = join(d, n); if (n === "node_modules" || n.startsWith(".")) return []; return statSync(p).isDirectory() ? walk(p) : [p]; }); }
const files = walk(root);
for (const f of files.filter(f => f.endsWith(".js") && !f.includes(`${join("tools")}`) && !f.includes("tests"))){
  try { execFileSync(process.execPath, ["--check", f], {stdio:"pipe"}); }
  catch(e){ bad++; console.error("SYNTAX", relative(root, f), String(e.stderr).split("\n").slice(0,4).join("\n")); }
}
for (const h of files.filter(f => f.endsWith(".html"))){
  const s = readFileSync(h, "utf8");
  for (const m of s.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)){
    const ref = m[1]; if (!ref || ref.endsWith("/")) continue;
    const p = join(dirname(h), ref); if (!existsSync(p)){ bad++; console.error("MISSING", relative(root, h), "->", ref); }
  }
}
if (bad){ console.error(`\n${bad} problem(s)`); process.exit(1); }
console.log(`OK: ${files.filter(f=>f.endsWith(".js")).length} JS files, ${files.filter(f=>f.endsWith(".html")).length} HTML files checked`);
