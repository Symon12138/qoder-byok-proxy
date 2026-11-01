#Requires -Version 5.1
<#
  Qoder IDE - custom model (BYOK) unlock patch
  Target : D:\Qoder IDE  (Qoder IDE 1.106.3)
  Effect : bypasses backend byokConfig.enabled=false and the server-side
           checkByokConfig validation, so Settings > Models > Add works and
           third-party providers / arbitrary Base URL can be configured.
  Run    : powershell -ExecutionPolicy Bypass -File patch-qoder-byok.ps1   (as Administrator)
  Revert : powershell -ExecutionPolicy Bypass -File <backup dir>\revert-qoder-byok.ps1
#>
param(
  [string]$Root = 'D:\Qoder IDE',
  [string]$BackupRoot = (Join-Path $PSScriptRoot '_qoder_byok_backup')
)

$ErrorActionPreference = 'Stop'
$logPath = (Join-Path $PSScriptRoot '_patch_log.txt')
function Log([string]$m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Output $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}

if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
Log "patch start; root=$Root"

$targets = @(
  (Join-Path $Root 'resources\app\out\vs\workbench\workbench.desktop.main.js'),
  (Join-Path $Root 'resources\app\out\lingma\agents-window\agents-window.desktop.main.js')
)

$patches = @(
  @{ Name = 'byok-remote-gate';
     Find = '_applyByokRemoteEnabledFromResponse(e){const r=e?.enabled!==!1;';
     Replace = '_applyByokRemoteEnabledFromResponse(e){const r=!0;' },
  @{ Name = 'byok-config-enabled';
     Find = 'return{enabled:e.enabled??!0,providers:e.providers}}';
     Replace = 'return{enabled:!0,providers:e.providers}}' },
  @{ Name = 'byok-check-bypass';
     Find = 'async checkByokConfig(e,r){';
     Replace = 'async checkByokConfig(e,r){return{success:!0};' },
  @{ Name = 'byok-model-availability';
     Find = '_getCustomModelDisabledReason(e,r,n,i=!0){';
     Replace = '_getCustomModelDisabledReason(e,r,n,i=!0){return;' }
)

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = Join-Path $BackupRoot $stamp
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Log "backup dir: $backupDir"

foreach ($file in $targets) {
  if (-not (Test-Path -LiteralPath $file)) { throw "target missing: $file" }
  $name = Split-Path $file -Leaf
  Copy-Item -LiteralPath $file -Destination (Join-Path $backupDir $name) -Force
  $before = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  Log "$name backup ok; sha256=$before; size=$((Get-Item -LiteralPath $file).Length)"

  $text = [System.IO.File]::ReadAllText($file)
  $original = $text

  foreach ($p in $patches) {
    $hit = ([regex]::Matches($text, [regex]::Escape($p.Find))).Count
    $done = ([regex]::Matches($text, [regex]::Escape($p.Replace))).Count
    if ($hit -eq 0) {
      if ($done -ge 1) { Log "$name :: $($p.Name) already applied"; continue }
      throw "anchor not found: $($p.Name) in $name"
    }
    if ($hit -ne 1) { throw "anchor count $hit (expected 1): $($p.Name) in $name" }
    $text = $text.Replace($p.Find, $p.Replace)
    Log "$name :: $($p.Name) applied"
  }

  if ($text -ne $original) {
    [System.IO.File]::WriteAllText($file, $text, (New-Object System.Text.UTF8Encoding($false)))
  }
  $after = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
  Log "$name written; sha256=$after; size=$((Get-Item -LiteralPath $file).Length)"
}

$workbench = Join-Path $Root 'resources\app\out\vs\workbench\workbench.desktop.main.js'
$agents = Join-Path $Root 'resources\app\out\lingma\agents-window\agents-window.desktop.main.js'
$revert = @"
#Requires -Version 5.1
`$ErrorActionPreference = 'Stop'
`$map = [ordered]@{
  '$workbench' = '$(Join-Path $backupDir 'workbench.desktop.main.js')'
  '$agents'    = '$(Join-Path $backupDir 'agents-window.desktop.main.js')'
}
foreach (`$k in `$map.Keys) {
  Copy-Item -LiteralPath `$map[`$k] -Destination `$k -Force
  Write-Output "restored: `$k"
}
Write-Output 'Qoder IDE BYOK patch reverted. Restart the IDE.'
"@
$revertPath = Join-Path $backupDir 'revert-qoder-byok.ps1'
[System.IO.File]::WriteAllText($revertPath, $revert, (New-Object System.Text.UTF8Encoding($false)))
Log "revert script: $revertPath"
Log 'PATCH DONE'
