#Requires -Version 5.1
# Experiment: pass the stored baseUrl as customModel.url (and parameters.url/base_url).
param([string]$Root = 'D:\Qoder IDE')

$ErrorActionPreference = 'Stop'
$logPath = (Join-Path $PSScriptRoot '_url_patch_log.txt')
function Log([string]$m) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m)
  Write-Output $line
  Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
}
if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }

$app = Join-Path $Root 'resources\app'
$files = @(
  (Join-Path $app 'out\vs\workbench\workbench.desktop.main.js'),
  (Join-Path $app 'out\lingma\agents-window\agents-window.desktop.main.js')
)

$find = 'type:u,is_vl:l.is_vl??!1'
$repl = 'type:u,url:l.baseUrl||"",is_vl:l.is_vl??!1'

foreach ($f in $files) {
  $name = Split-Path $f -Leaf
  $text = [System.IO.File]::ReadAllText($f)
  if ($text.Contains($repl)) { Log "$name :: already applied"; continue }
  $hits = ([regex]::Matches($text, [regex]::Escape($find))).Count
  if ($hits -eq 0) { Log "$name :: anchor absent"; continue }
  if ($hits -gt 3) { throw "unexpected anchor count $hits in $name" }
  $text = $text.Replace($find, $repl)
  [System.IO.File]::WriteAllText($f, $text, (New-Object System.Text.UTF8Encoding($false)))
  Log "$name patched (url passthrough, $hits sites)"
}

$map = [ordered]@{
  'vs/workbench/workbench.desktop.main.js'             = $files[0]
  'lingma/agents-window/agents-window.desktop.main.js' = $files[1]
}
function Get-ChecksumB64([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create(); $fs = [System.IO.File]::OpenRead($p)
  try { $h = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
  return [Convert]::ToBase64String($h).TrimEnd('=')
}
$hashes = @{}
foreach ($k in $map.Keys) { $hashes[$k] = Get-ChecksumB64 $map[$k] }
foreach ($jsonName in @('product.json', 'featureFlags.json')) {
  $path = Join-Path $app $jsonName
  $text = [System.IO.File]::ReadAllText($path)
  $changed = 0
  foreach ($k in $hashes.Keys) {
    $m = [regex]::Match($text, '"' + [regex]::Escape($k) + '"\s*:\s*"([^"]+)"')
    if (-not $m.Success) { continue }
    if ($m.Groups[1].Value -eq $hashes[$k]) { continue }
    $text = $text.Replace($m.Groups[1].Value, $hashes[$k]); $changed++
  }
  if ($changed -gt 0) {
    [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))
    Log "$jsonName checksums updated ($changed)"
  }
}
Log 'DONE'
