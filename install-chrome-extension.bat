@echo off
title FormVault AI - Install in Chrome
cd /d "%~dp0"

set "CHROME_EXT=%USERPROFILE%\Desktop\FormVaultAI-Load-In-Chrome"

echo.
echo  FormVault AI - Chrome Extension Installer
echo  ==========================================
echo.

echo  Building extension...
call npm run build
if errorlevel 1 (
  echo.
  echo  Build FAILED.
  pause
  exit /b 1
)

if not exist "%CHROME_EXT%\manifest.json" (
  echo.
  echo  ERROR: Extension was not copied to Desktop.
  pause
  exit /b 1
)

echo.
echo  ==========================================
echo   Extension copied to your DESKTOP:
echo.
echo   %CHROME_EXT%
echo.
echo   In Chrome (chrome://extensions):
echo   1. Developer mode ON
echo   2. Load unpacked
echo   3. Select "FormVaultAI-Load-In-Chrome"
echo      from your DESKTOP
echo.
echo   DO NOT select the paapi folder!
echo  ==========================================
echo.

start "" "chrome://extensions"
explorer "%CHROME_EXT%"

pause
