@echo off
rem Starts FigSom and opens it in the browser. Close the minimized window to stop it.
cd /d "%~dp0"
if not exist node_modules call npm install --no-fund
start "FigSom" /min node server\index.js --open
