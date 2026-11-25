@echo off
rem Abre o Figuraudio no navegador. Feche a janela "Figuraudio" para encerrar.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js nao encontrado. Veja o passo 1 do README.md. & pause & exit /b 1)
if not exist "node_modules\@whiskeysockets\baileys\package.json" (
  echo Instalando as dependencias, so na primeira vez...
  call npm ci --no-fund --no-audit || (echo A instalacao falhou. Veja a mensagem acima. & pause & exit /b 1)
)
start "Figuraudio" cmd /c "node server\index.js --open || pause"
