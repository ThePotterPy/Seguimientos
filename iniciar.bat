@echo off
chcp 65001 > nul
cd /d "%~dp0"
title SEGUIMIENTO BGH
start "" /b node -e "setTimeout(()=>require('child_process').exec('start http://localhost:3333'),1500)"
node server.js
pause
