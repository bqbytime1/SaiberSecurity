@echo off
setlocal
title SaiberSecurity - stop local website

echo.
echo   Stopping the SaiberSecurity website...

REM Only kill the process actually listening on port 80, so other Node apps are
REM left alone.
set FOUND=
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"TCP.*:80 .*LISTENING"') do (
  set FOUND=1
  taskkill /f /pid %%p >nul 2>&1
  echo   Stopped process %%p.
)

if not defined FOUND echo   Nothing was listening on port 80.
echo.
timeout /t 3 /nobreak >nul
