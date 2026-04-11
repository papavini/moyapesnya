@echo off
cd /d "%~dp0"
echo ================================
echo  SUNO Bot - debug info
echo ================================
echo.
echo Current directory:
cd
echo.
echo PATH check - Node:
where node
echo PATH check - npm:
where npm
echo.
echo Node version:
node -v 2>nul || echo NODE NOT FOUND
echo npm version:
npm -v 2>nul || echo NPM NOT FOUND
echo.
echo Files in this folder:
dir /b
echo.
echo node_modules present:
if exist "node_modules" (echo YES) else (echo NO - need to run npm install)
if exist "node_modules\grammy" (echo grammy installed: YES) else (echo grammy installed: NO)
echo.
echo .env present:
if exist ".env" (echo YES) else (echo NO - copy .env.example to .env)
echo.
echo ================================
pause
