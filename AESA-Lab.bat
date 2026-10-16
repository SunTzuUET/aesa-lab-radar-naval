@echo off
title AESA-Lab
cd /d "%~dp0web"

rem If the server is already running, just open the browser
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:5173/) | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" http://localhost:5173/
  exit /b
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
)

rem Open the browser once the server responds
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){ try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://localhost:5173/ | Out-Null; Start-Process 'http://localhost:5173/'; break } catch { Start-Sleep -Milliseconds 500 } }"

echo AESA-Lab at http://localhost:5173  (close this window to stop it)
call npm run dev -- --port 5173 --strictPort
