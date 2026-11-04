@echo off
title Discount World - Shop print agent
cd /d "%~dp0\.."
echo.
echo  Shop print agent (Zebra labels)
echo  - Local bridge :9288  (same-PC print)
echo  - Cloud queue poller  (PROD / phone / other laptop)
echo  Keep this window open, OR add it to Windows Startup once.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js not found. Install from https://nodejs.org then try again.
  pause
  exit /b 1
)

if not exist ".env" (
  echo ERROR: Missing .env in project root.
  echo Copy .env.example and set VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  echo ^(service role is only for this shop PC agent — never put it in the website^).
  pause
  exit /b 1
)

findstr /I /C:"SUPABASE_SERVICE_ROLE_KEY" ".env" >nul
if errorlevel 1 (
  echo WARNING: SUPABASE_SERVICE_ROLE_KEY not found in .env
  echo Cloud queue printing will fail until you add it ^(Supabase Dashboard -^> Settings -^> API^).
  echo.
)

echo Optional: add this .bat to Windows Startup so it runs after login.
echo   Win+R → shell:startup → copy a shortcut to this file there.
echo.
call npm run print-agent
echo.
echo Agent stopped.
pause
