@echo off
rem TRAILS on this computer: install (first run), build, start the app + AI storyteller, open the browser.
rem Double-click it, or run start-trails.cmd from cmd/PowerShell. Works where PowerShell blocks npm.ps1.
rem The storyteller reads STORY_API_BASE, STORY_MODEL, STORY_API_KEY, STORY_PROVIDER_LABEL from .env.local
rem (never committed). Without them the app still runs and tells offline stories.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm.cmd install || (pause & exit /b 1)
)
echo Building...
call npm.cmd run build || (pause & exit /b 1)
start "" http://localhost:8787
echo.
echo TRAILS is running on http://localhost:8787  -  close this window to stop it.
call npm.cmd run story
pause
