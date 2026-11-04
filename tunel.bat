@echo off
chcp 65001 >nul
title 31. Zlatna kuna - privremeni tunel
cd /d "%~dp0"

rem Privremena javna HTTPS adresa za probu s mobitela (Cloudflare Quick Tunnel).
rem Aplikacija mora biti pokrenuta (start.bat) prije ovoga.
rem cloudflared.exe stavite u ovu mapu ili u %LOCALAPPDATA%\Programs\cloudflared\

set "CF=cloudflared.exe"
if exist "%~dp0cloudflared.exe" set "CF=%~dp0cloudflared.exe"
if exist "%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe" set "CF=%LOCALAPPDATA%\Programs\cloudflared\cloudflared.exe"

where "%CF%" >nul 2>nul
if errorlevel 1 if not exist "%CF%" (
  echo Nije pronadjen cloudflared.exe.
  echo Preuzmite "cloudflared-windows-amd64.exe" sa:
  echo   https://github.com/cloudflare/cloudflared/releases/latest
  echo preimenujte ga u cloudflared.exe i stavite u ovu mapu.
  pause
  exit /b 1
)

echo.
echo Pokrecem tunel. Za nekoliko sekundi pojavit ce se adresa oblika
echo   https://nesto-nesto.trycloudflare.com
echo Tu adresu upisite u Android aplikaciju (ili otvorite u pregledniku na mobitelu).
echo Tunel radi dok je ovaj prozor otvoren.
echo.
"%CF%" tunnel --no-autoupdate --url http://127.0.0.1:3000
pause
