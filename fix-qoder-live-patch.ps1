#Requires -Version 5.1
# Fix the extra ')' introduced by patch-qoder-live-model.ps1 and refresh checksums.
param([string]$Root = 'D:\Qoder IDE')
$ErrorActionPreference = 'Stop'
$app = Join-Path $Root 'resources\app'
$files = @(
  (Join-Path $app 'out\vs\workbench\workbench.desktop.main.js'),
  (Join-Path $app 'out\lingma\agents-window\agents-window.desktop.main.js')
)
$broken = 'this._registerGetCustomModelsHandler());const _lm=this;'
$fixed  = 'this._registerGetCustomModelsHandler();const _lm=this;'
foreach ($f in $files) {
  $t = [System.IO.File]::ReadAllText($f)
  $n = ([regex]::Matches($t, [regex]::Escape($broken))).Count
  if ($n -eq 0) { Write-Output "$(Split-Path $f -Leaf): nothing to fix"; continue }
  if ($n -ne 1) { throw "unexpected $n occurrences in $f" }
  [System.IO.File]::WriteAllText($f, $t.Replace($broken, $fixed), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "$(Split-Path $f -Leaf): fixed"
}
function Get-ChecksumB64([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create(); $fs = [System.IO.File]::OpenRead($p)
  try { $h = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
  return [Convert]::ToBase64String($h).TrimEnd('=')
}
$map = [ordered]@{
  'vs/workbench/workbench.desktop.main.js'                   = $files[0]
  'lingma/agents-window/agents-window.desktop.main.js'       = $files[1]
  'vs/code/electron-browser/workbench/workbench.html'        = (Join-Path $app 'out\vs\code\electron-browser\workbench\workbench.html')
  'lingma/agents-window/electron-browser/agents-window.html' = (Join-Path $app 'out\lingma\agents-window\electron-browser\agents-window.html')
}
foreach ($jsonName in @('product.json', 'featureFlags.json')) {
  $path = Join-Path $app $jsonName
  $jt = [System.IO.File]::ReadAllText($path)
  $changed = 0
  foreach ($k in $map.Keys) {
    $hash = Get-ChecksumB64 $map[$k]
    $m = [regex]::Match($jt, '"' + [regex]::Escape($k) + '"\s*:\s*"([^"]+)"')
    if (-not $m.Success) { continue }
    if ($m.Groups[1].Value -eq $hash) { continue }
    $jt = $jt.Replace($m.Groups[1].Value, $hash); $changed++
  }
  if ($changed -gt 0) {
    [System.IO.File]::WriteAllText($path, $jt, (New-Object System.Text.UTF8Encoding($false)))
    Write-Output "${jsonName}: $changed checksums refreshed"
  }
}
