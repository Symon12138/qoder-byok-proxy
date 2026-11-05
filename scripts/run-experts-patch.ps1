# Runs experts-patch.js (node) against the Qoder install root.
# Kept ASCII-only on purpose: Windows PowerShell 5.1 misparses UTF-8 without BOM.
# Root resolution order: -Root param > config.json ideRoot > hardcoded default.
param([string]$Root = '')

$ErrorActionPreference = 'Stop'

if (-not $Root) {
    $cfg = Join-Path $PSScriptRoot '..\qoder-proxy\config.json'
    if (Test-Path -LiteralPath $cfg) {
        try { $Root = (Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json).ideRoot } catch { }
    }
}
if (-not $Root) { $Root = 'D:\Qoder IDE' }

$node = 'E:\environment\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $node)) { $node = 'node' }

$script = Join-Path $PSScriptRoot 'experts-patch.js'
if (-not (Test-Path -LiteralPath $script)) {
    Write-Host "experts-patch.js missing: $script"
    exit 2
}

Write-Host "root=$Root"
& $node $script --root $Root
exit $LASTEXITCODE
