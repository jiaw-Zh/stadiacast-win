@echo off
rem Double-click to open the Stadia web console (http://127.0.0.1:8090/).
setlocal
set "SCRIPT=%~dp0scripts\start-webui.ps1"
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -File "%SCRIPT%"
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
)
if errorlevel 1 pause
