# Запуск SUNO Sales Bot (только Telegram) из PowerShell.
# Если PowerShell ругается на запуск скриптов — открой его от админа и выполни:
#   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "================================" -ForegroundColor Cyan
Write-Host " SUNO Sales Bot - Telegram only" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js не найден. Установи Node.js 20+ с https://nodejs.org" -ForegroundColor Red
    Read-Host "Нажми Enter для выхода"
    exit 1
}

if (-not (Test-Path "node_modules\grammy")) {
    Write-Host "[setup] Ставлю зависимости, подожди минуту..." -ForegroundColor Yellow
    npm install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install упал." -ForegroundColor Red
        Read-Host "Нажми Enter для выхода"
        exit 1
    }
}

Write-Host "[run] Запускаю бота... Останови Ctrl+C." -ForegroundColor Green
Write-Host ""
npm run start:tg

Write-Host ""
Write-Host "Бот остановлен." -ForegroundColor Yellow
Read-Host "Нажми Enter для выхода"
