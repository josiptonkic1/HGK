@echo off
chcp 65001 >nul
title 31. Zlatna kuna - pozivnice
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js nije instaliran. Preuzmite ga s https://nodejs.org (verzija 22 ili novija^).
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instaliram potrebne pakete...
  call npm ci --omit=dev
)

if not exist .env (
  copy .env.example .env >nul
  echo Kreirana je datoteka .env - upisite lozinke za admina i moderatora pa ponovno pokrenite.
  notepad .env
  exit /b 0
)

echo Aplikacija se pokrece na http://localhost:3000
echo Za zaustavljanje zatvorite ovaj prozor.
start "" http://localhost:3000/prijava
node --disable-warning=ExperimentalWarning --env-file-if-exists=.env index.js
pause
