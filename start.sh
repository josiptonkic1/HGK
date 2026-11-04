#!/bin/sh
# Pokretanje na Linuxu / macOS-u.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js nije instaliran (potrebna verzija 22+)."; exit 1; }
[ -d node_modules ] || npm ci --omit=dev
[ -f .env ] || node scripts/init-env.mjs
exec node --disable-warning=ExperimentalWarning --env-file-if-exists=.env index.js
