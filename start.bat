@echo off
cd /d "%~dp0"
call :main
set EXITCODE=%ERRORLEVEL%
echo.
echo ================================
echo  Exit code: %EXITCODE%
echo ================================
pause
exit /b %EXITCODE%

:main
echo ================================
echo  SUNO Sales Bot - Telegram only
echo ================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found in PATH.
  echo Install Node.js 20+ from https://nodejs.org
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found in PATH.
  exit /b 1
)

echo Node version:
node -v
echo npm version:
npm -v
echo.

if not exist "node_modules\grammy" (
  echo [setup] Installing dependencies, please wait...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed. See output above.
    exit /b 1
  )
)

echo [run] Starting bot (Telegram only). Press Ctrl+C to stop.
echo.
call npm run start:tg
exit /b %ERRORLEVEL%
