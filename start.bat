@echo off
rem Hand Dart: start the local server and open the browser. Needs Node.js.
cd /d "%~dp0"
start "" http://localhost:5173/
node serve.mjs 5173
pause
