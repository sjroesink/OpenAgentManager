#!/usr/bin/env pwsh
# OpenAgentManager installer for Windows
# Usage: irm https://sjroesink.github.io/OpenAgentManager/install.ps1 | iex
# Optional channel: $env:OAM_CHANNEL='preview'; irm ... | iex

$ErrorActionPreference = "Stop"
$repo = "sjroesink/OpenAgentManager"
$name = "OpenAgentManager"
$channel = $env:OAM_CHANNEL
if ([string]::IsNullOrWhiteSpace($channel)) {
    $channel = "stable"
}
$channel = $channel.ToLowerInvariant()

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
$url = ""

if ($channel -eq "preview") {
    $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -UseBasicParsing
    $previewRelease = $releases |
        Where-Object { $_.prerelease -eq $true -and $_.draft -eq $false } |
        Select-Object -First 1

    if (-not $previewRelease) {
        Write-Host "  Error: Could not find a preview release." -ForegroundColor Red
        exit 1
    }

    $tag = $previewRelease.tag_name
    $url = "https://github.com/$repo/releases/download/$tag/$fileName"
    Write-Host "  Channel: preview ($tag)" -ForegroundColor Gray
} else {
    $url = "https://github.com/$repo/releases/latest/download/$fileName"
    Write-Host "  Channel: stable (latest)" -ForegroundColor Gray
}

$outFile = Join-Path $env:TEMP $fileName

Write-Host "  Downloading $fileName..." -ForegroundColor Gray
Invoke-WebRequest -Uri $url -OutFile $outFile -UseBasicParsing

Write-Host "  Running installer..." -ForegroundColor Gray
Start-Process -FilePath $outFile

Write-Host ""
Write-Host "  Done! The installer should now be running." -ForegroundColor Green
Write-Host ""
