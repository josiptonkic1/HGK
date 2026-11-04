#!/bin/sh
# Pokretanje na Linuxu / macOS-u.
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null 2>&1 || { echo "Node.js nije instaliran (potrebna verzija 22+)."; exit 1; }
[ -d node_modules ] || npm ci --omit=dev
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Kreirana je datoteka .env - upisite lozinke pa ponovno pokrenite."
  exit 0
fi
exec node --disable-warning=ExperimentalWarning --env-file-if-exists=.env index.js
