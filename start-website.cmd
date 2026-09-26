@echo off
setlocal
title SaiberSecurity - local website

cd /d "%~dp0"

REM Production mode: faster pages, no development overlay.
set NODE_ENV=production

REM Live host monitoring defaults to off in production because on a real server it
REM would report the server's own traffic. This is your own machine, so turn it on.
set HOST_MONITOR_ENABLED=true
set HOST_MONITOR_INTERVAL_MS=15000

REM No mail account is configured here, so let password reset show its link in the
REM page instead of emailing it. Safe only because this site is loopback-only; never
REM set this on a deployment anyone else can reach.
set MAIL_DEV_FALLBACK=true

REM Bind to loopback only. The site is reachable from this computer and nothing else,
REM which matters because it records which addresses this machine connects to.
set HOSTNAME=127.0.0.1
set PORT=80

echo.
echo   SaiberSecurity - starting local website
echo   ---------------------------------------
echo.

if not exist "node_modules\next" (
  echo   Installing dependencies. This happens once and takes a few minutes...
  call npm install || goto :failed
)

if not exist "prisma\dev.db" (
  echo   Setting up the database and demo data...
  call npm run setup || goto :failed
)

if not exist ".next\BUILD_ID" (
  echo   Building the site. This happens once and takes about a minute...
  call npm run build || goto :failed
)

echo   Serving at http://localhost
echo   Close this window to stop the site.
echo.

REM Give the server a moment to bind before the browser opens.
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start http://localhost"

node "node_modules\next\dist\bin\next" start --hostname 127.0.0.1 --port 80
goto :eof

:failed
echo.
echo   Something went wrong above. The window will stay open so you can read it.
pause
