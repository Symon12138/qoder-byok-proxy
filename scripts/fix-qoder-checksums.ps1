#Requires -Version 5.1
# Refresh Qoder IDE product.json / featureFlags.json checksums after the BYOK patch.
# Run elevated.
param(
  [string]$Root = 'D:\Qoder IDE'
)

$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot '_checksum_log.txt'
function Log([string]$m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Output $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }

$app = Join-Path $Root 'resources\app'
$targets = [ordered]@{
  'vs/workbench/workbench.desktop.main.js'                     = (Join-Path $app 'out\vs\workbench\workbench.desktop.main.js')
  'lingma/agents-window/agents-window.desktop.main.js'         = (Join-Path $app 'out\lingma\agents-window\agents-window.desktop.main.js')
}

function Get-ChecksumB64([string]$path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $fs = [System.IO.File]::OpenRead($path)
  try { $hash = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
  return [Convert]::ToBase64String($hash).TrimEnd('=')
}

$newHashes = @{}
foreach ($k in $targets.Keys) {
  $newHashes[$k] = Get-ChecksumB64 $targets[$k]
  Log "computed $k = $($newHashes[$k])"
}

foreach ($jsonName in @('product.json', 'featureFlags.json')) {
  $path = Join-Path $app $jsonName
  $text = [System.IO.File]::ReadAllText($path)
  $backup = "$path.bak-byok"
  if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $path -Destination $backup -Force }
  $changed = 0
  foreach ($k in $newHashes.Keys) {
    $old = [regex]::Match($text, '"' + [regex]::Escape($k) + '"\s*:\s*"([^"]+)"')
    if (-not $old.Success) { Log "$jsonName :: key not found: $k"; continue }
    $oldHash = $old.Groups[1].Value
    if ($oldHash -eq $newHashes[$k]) { Log "$jsonName :: $k already current"; continue }
    $text = $text.Replace($oldHash, $newHashes[$k])
    $changed++
    Log "$jsonName :: $k  $oldHash -> $($newHashes[$k])"
  }
  if ($changed -gt 0) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
    Log "$jsonName written ($changed entries)"
  }
}
Log 'CHECKSUM FIX DONE'
