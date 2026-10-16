@echo off
chcp 65001 > nul
title Rastreador Urbano Express
echo ===================================================
echo   Iniciando Rastreador Urbano Express...
echo   Abriendo navegador en http://localhost:3333
echo ===================================================
timeout /t 1 /nobreak > nul
start http://localhost:3333
node server.js

pause
