#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$repo_root"

git diff --check

if ! cmp -s index.html brief.html || ! cmp -s index.html live.html; then
  echo "index.html, brief.html, and live.html must remain byte-identical." >&2
  exit 1
fi

node_bin=$(command -v node || true)
if [ -z "$node_bin" ] && [ -x /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node ]; then
  node_bin=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node
fi

if [ -z "$node_bin" ]; then
  echo "Node.js is required to verify JavaScript syntax." >&2
  exit 1
fi

"$node_bin" --check assets/weather-core.js
"$node_bin" --check sw.js

"$node_bin" <<'NODE'
const fs = require('fs');
const path = require('path');

for (const name of fs.readdirSync('.').filter(name => name.endsWith('.html'))) {
  const source = fs.readFileSync(name, 'utf8');
  const scripts = [...source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    try {
      new Function(match[1]);
    } catch (error) {
      throw new Error(`${path.resolve(name)} inline script ${index + 1}: ${error.message}`);
    }
  });
}

JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
NODE

echo "Static-site verification passed."
