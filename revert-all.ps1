#Requires -Version 5.1
# Full revert: restore Qoder to its factory state (no proxy, original bundles,
# original settings). Requires admin (writes under the install directory).
# ASCII-only on purpose: Windows PowerShell 5.1 misparses UTF-8 without BOM.
param(
  [string]$Root = 'D:\Qoder IDE',
  [string]$UserDir = (Join-Path $env:APPDATA 'Qoder'),
  [string]$ArgvPath = (Join-Path $env:USERPROFILE '.qoder\argv.json'),
  [string]$BackupDir = '',
  [switch]$KeepModelRecord
)

$ErrorActionPreference = 'Stop'

# Pick the newest backup whose bundle is still UNPATCHED (pristine).
# apply-all.ps1 snapshots the CURRENT bundle every run; if it was already
# patched, that snapshot is patched too - reverting to it would be a no-op.
if (-not $BackupDir) {
  $bkRoot = Join-Path $PSScriptRoot '_qoder_byok_backup'
  if (Test-Path -LiteralPath $bkRoot) {
    # All four patch markers must be absent for a backup to count as pristine.
    # Checking only one marker is not enough: some snapshots had 2 of 4 patches
    # already applied, and restoring those leaves the IDE half-patched.
    $wbMarkers = @(
      '_applyByokRemoteEnabledFromResponse(e){const r=!0;',
      'shouldShowCommercialMessage(t,e){return!1;',
      '_lm=this;setInterval'
    )
    # P4 (experts BYOK gate unlock) replaced the old P2 concat marker when the
    # custom-model injection was removed; custom models now rely on Qoder's
    # native "Custom" grouping instead of being merged into the normal list.
    $awMarker = 'useMemo)(()=>!1,[Q.userPlan,Q.userInfo,'
    $dirs = Get-ChildItem -LiteralPath $bkRoot -Directory | Sort-Object Name -Descending
    foreach ($d in $dirs) {
      $wb = Join-Path $d.FullName 'workbench.desktop.main.js'
      $aw = Join-Path $d.FullName 'agents-window.desktop.main.js'
      if (-not (Test-Path -LiteralPath $wb)) { continue }
      $dirty = $false
      foreach ($m in $wbMarkers) {
        if (Select-String -LiteralPath $wb -Pattern ([regex]::Escape($m)) -Quiet) { $dirty = $true; break }
      }
      if (-not $dirty -and (Test-Path -LiteralPath $aw)) {
        if (Select-String -LiteralPath $aw -Pattern ([regex]::Escape($awMarker)) -Quiet) { $dirty = $true }
      }
      if (-not $dirty) { $BackupDir = $d.FullName; break }
    }
  }
}
if (-not $BackupDir) { throw 'no PRISTINE backup found (all backups look patched)' }
$logPath = Join-Path $PSScriptRoot '_revert_all_log.txt'
function Log([string]$m) { Add-Content -LiteralPath $logPath -Value ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 }
if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
Log "start root=$Root"

$app = Join-Path $Root 'resources\app'

# Sanity: the root must really be a Qoder install that carries the bundle we patch.
# A wrong root (e.g. the launcher-managed D:\Qoder) has no bundle and every later
# step would silently do nothing, leaving the IDE half-patched.
$wbBundle = Join-Path $app 'out\vs\workbench\workbench.desktop.main.js'
$awBundle = Join-Path $app 'out\lingma\agents-window\agents-window.desktop.main.js'
if (-not (Test-Path -LiteralPath $wbBundle)) {
  Log "ABORT: no workbench bundle under $Root"
  Log "REVERT-ALL FAILED"
  exit 2
}
if (-not (Test-Path -LiteralPath $awBundle)) {
  Log "ABORT: no agents-window bundle under $Root"
  Log "REVERT-ALL FAILED"
  exit 2
}
Log "bundle ok: both present"

# ---- 1. stop proxy + console ----
Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object {
  try { $cl = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine } catch { $cl = '' }
  if ($cl -match 'qoder-proxy\\(proxy|admin)\.js') { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue; Log "stopped node pid=$($_.Id)" }
}

# ---- 2. restore pristine bundles ----
$pairs = @(
  @{ Name = 'workbench.desktop.main.js'; Key = 'vs/workbench/workbench.desktop.main.js' },
  @{ Name = 'agents-window.desktop.main.js'; Key = 'lingma/agents-window/agents-window.desktop.main.js' }
)
$targets = @{
  'workbench.desktop.main.js' = Join-Path $app 'out\vs\workbench\workbench.desktop.main.js'
  'agents-window.desktop.main.js' = Join-Path $app 'out\lingma\agents-window\agents-window.desktop.main.js'
}
foreach ($p in $pairs) {
  $src = Join-Path $BackupDir $p.Name
  $dst = $targets[$p.Name]
  if (-not (Test-Path $src)) { Log "SKIP missing backup $($p.Name)"; continue }
  Copy-Item -LiteralPath $src -Destination $dst -Force
  Log "restored bundle $($p.Name)"
}

# ---- 3. restore CSP in html ----
$htmls = @(
  (Join-Path $app 'out\vs\code\electron-browser\workbench\workbench.html'),
  (Join-Path $app 'out\lingma\agents-window\electron-browser\agents-window.html')
)
foreach ($h in $htmls) {
  if (-not (Test-Path $h)) { continue }
  $t = [System.IO.File]::ReadAllText($h)
  if ($t -match '127\.0\.0\.1:8788') {
    $t = [regex]::Replace($t, "\r?\n\s*http://127\.0\.0\.1:8788", '')
    [System.IO.File]::WriteAllText($h, $t, (New-Object System.Text.UTF8Encoding($false)))
    Log "csp cleaned: $(Split-Path $h -Leaf)"
  }
}

# ---- 4. recompute checksums ----
function Get-ChecksumB64([string]$p) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $fs = [System.IO.File]::OpenRead($p)
  try { $h = $sha.ComputeHash($fs) } finally { $fs.Dispose(); $sha.Dispose() }
  return [Convert]::ToBase64String($h).TrimEnd('=')
}
$map = [ordered]@{
  'vs/workbench/workbench.desktop.main.js'                   = $targets['workbench.desktop.main.js']
  'lingma/agents-window/agents-window.desktop.main.js'       = $targets['agents-window.desktop.main.js']
  'vs/code/electron-browser/workbench/workbench.html'        = $htmls[0]
  'lingma/agents-window/electron-browser/agents-window.html' = $htmls[1]
}
foreach ($jsonName in @('product.json', 'featureFlags.json')) {
  $path = Join-Path $app $jsonName
  $jt = [System.IO.File]::ReadAllText($path)
  $changed = 0
  foreach ($k in $map.Keys) {
    $f = $map[$k]
    if (-not (Test-Path $f)) { continue }
    $hash = Get-ChecksumB64 $f
    $m = [regex]::Match($jt, '"' + [regex]::Escape($k) + '"\s*:\s*"([^"]+)"')
    if (-not $m.Success) { continue }
    if ($m.Groups[1].Value -eq $hash) { continue }
    $jt = $jt.Replace($m.Groups[1].Value, $hash); $changed++
  }
  if ($changed -gt 0) {
    [System.IO.File]::WriteAllText($path, $jt, (New-Object System.Text.UTF8Encoding($false)))
    Log "${jsonName}: $changed checksums refreshed"
  }
}

# ---- 5. settings.json: drop http.proxy, re-enable auto update ----
$settingsPath = Join-Path $UserDir 'User\settings.json'
if (Test-Path $settingsPath) {
  $s = Get-Content $settingsPath -Raw | ConvertFrom-Json
  $hadProxy = $null -ne $s.PSObject.Properties['http.proxy']
  if ($hadProxy) { $s.PSObject.Properties.Remove('http.proxy'); Log "settings: http.proxy removed (was $($s.'http.proxy'))" }
  if ($s.app) { $s.app.configAdvancedAutoUpdate = $true; Log 'settings: configAdvancedAutoUpdate=true' }
  ($s | ConvertTo-Json -Depth 20) | Out-File -FilePath $settingsPath -Encoding utf8
}
$appJsonPath = Join-Path $UserDir 'User\app.json'
if (Test-Path $appJsonPath) {
  $a = Get-Content $appJsonPath -Raw | ConvertFrom-Json
  if ($a.config -and $a.config.advanced) { $a.config.advanced.autoUpdate = $true; Log 'app.json: autoUpdate=true' }
  ($a | ConvertTo-Json -Depth 20) | Out-File -FilePath $appJsonPath -Encoding utf8
}

# ---- 6. argv.json: drop ignore-certificate-errors ----
if (Test-Path $ArgvPath) {
  $t = [System.IO.File]::ReadAllText($ArgvPath)
  if ($t -match 'ignore-certificate-errors') {
    $t = [regex]::Replace($t, ',?\s*\r?\n\s*"ignore-certificate-errors"\s*:\s*true', '')
    $t = $t.Replace('"locale": "zh-cn",' + "`r`n}", '"locale": "zh-cn"' + "`r`n}")
    [System.IO.File]::WriteAllText($ArgvPath, $t, (New-Object System.Text.UTF8Encoding($false)))
    Log 'argv.json: ignore-certificate-errors removed'
  }
}

# ---- 7. optional: drop the custom model record ----
if (-not $KeepModelRecord) {
  Log 'model record kept (pass -KeepModelRecord:$false to drop it manually)'
}

Log 'REVERT-ALL DONE'
Write-Host 'REVERT OK'
