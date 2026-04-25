@echo off
:: =============================================================
:: AoE4 Replay Launcher - Installer / Uninstaller
:: =============================================================
::
:: Usage:
::   install.bat           - Install the native host
::   install.bat uninstall - Remove everything
::
:: Source: https://github.com/spartain-aoe/aoe4world-replay-extension
:: =============================================================

if "%1"=="uninstall" goto :uninstall

echo.
echo  AoE4 Replay Launcher - Installer
echo  =================================
echo.

set "DIR=%~dp0"

where powershell >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: PowerShell not found.
    pause
    exit /b 1
)

echo  Installing to %%LOCALAPPDATA%%\AoE4ReplayLauncher ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& '%DIR%aoe4_replay_setup.ps1' -ExtensionId 'ckkbdeejodfnpehhllhmhhannpgojfec'"

echo.
echo  Done! You can now use "Watch Replay" on aoe4world.com.
echo  To uninstall later, run: install.bat uninstall
echo.
pause
exit /b 0

:uninstall
echo.
echo  Uninstalling...
set "DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "& '%DIR%aoe4_replay_setup.ps1' -Uninstall"
echo  Done. You can delete this folder now.
pause
