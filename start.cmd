@echo off
rem Double-click entry for start.ps1 (Qoder BYOK proxy + web console).
rem   start.cmd            start both, keep the window open so you can read it
rem   start.cmd -Status    show status and exit
rem   start.cmd -Stop      stop both and exit
rem   start.cmd -Open      start both and open the console page
rem Scripted use: call start.ps1 directly (this wrapper only pauses for humans).
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
rem No arguments = double-clicked: hold the window so the output stays readable.
if "%~1"=="" pause
endlocal
