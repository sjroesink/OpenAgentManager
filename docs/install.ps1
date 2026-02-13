#!/usr/bin/env pwsh
# OpenAgentManager installer for Windows
# Usage: irm https://sjroesink.github.io/OpenAgentManager/install.ps1 | iex

$ErrorActionPreference = "Stop"
$repo = "sjroesink/OpenAgentManager"
$name = "OpenAgentManager"

Write-Host ""
Write-Host "  Installing $name..." -ForegroundColor Cyan
Write-Host ""

# Detect architecture
$arch = if ([Environment]::Is64BitOperatingSystem) {
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x64" }
} else {
    Write-Host "  Error: 32-bit systems are not supported." -ForegroundColor Red
    exit 1
}

$fileName = "$name-win-$arch.exe"
$url = "https://github.com/$repo/releases/latest/download/$fileName"
$outFile = Join-Path $env:TEMP $fileName

Write-Host "  Downloading $fileName..." -ForegroundColor Gray
Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing

Write-Host "  Running installer..." -ForegroundColor Gray
Start-Process -FilePath $outFile

Write-Host ""
Write-Host "  Done! The installer should now be running." -ForegroundColor Green
Write-Host ""
