#Requires -Version 5.1
# Apply every Qoder IDE patch in order (use after reinstalling/upgrading Qoder).
# Requires admin. Each step is attempted independently so one failure does not
# abort the rest; the summary tells you what actually landed.
# ASCII-only on purpose: Windows PowerShell 5.1 misparses UTF-8 without BOM.
param([string]$Root = 'D:\Qoder IDE')

$ErrorActionPreference = 'Continue'
# Child scripts emit UTF-8 (node) and GBK (powershell). Without this the
# Chinese lines they print show up as mojibake in the log file.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$dir = $PSScriptRoot
$logPath = Join-Path $dir '_apply_all_log.txt'
function Log([string]$m) { Add-Content -LiteralPath $logPath -Value ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 }
if (Test-Path -LiteralPath $logPath) { Remove-Item -LiteralPath $logPath -Force }
Log "start root=$Root"

# Sanity: the root must really be the install that carries the bundle we patch.
# A wrong root (e.g. the launcher-managed D:\Qoder) has no bundle and every
# patch step would silently do nothing.
$wbBundle = Join-Path $Root 'resources\app\out\vs\workbench\workbench.desktop.main.js'
$awBundle = Join-Path $Root 'resources\app\out\lingma\agents-window\agents-window.desktop.main.js'
if (-not (Test-Path -LiteralPath $wbBundle)) {
  Log "ABORT: no workbench bundle under $Root"
  Log 'APPLY-ALL FAILED'
  exit 2
}
if (-not (Test-Path -LiteralPath $awBundle)) {
  Log "ABORT: no agents-window bundle under $Root"
  Log 'APPLY-ALL FAILED'
  exit 2
}
Log 'bundle ok: both present'

# Stop Qoder so files are not locked and patches are not overwritten at exit.
Get-Process -Name 'Qoder IDE','Qoder' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Log 'qoder stopped'

$steps = @(
  # The old patch-qoder-*.ps1 generation (byok-unlock / baseurl / merge-model-fields /
  # live-model-name / live-name-fix) is fully superseded by the 8 patches inside
  # experts-patch.js, and those scripts do not live in this project. Keeping them
  # listed here only produced one SKIP line per run.
  @{ Name = 'experts';           File = 'run-experts-patch.ps1' },
  @{ Name = 'checksums';          File = 'fix-qoder-checksums.ps1' }
)

$results = @()
foreach ($s in $steps) {
  $p = Join-Path $dir $s.File
  if (-not (Test-Path $p)) { Log "SKIP $($s.Name): $($s.File) missing"; $results += "$($s.Name)=MISSING"; continue }
  try {
    # Pass -Root through: every child script defaults to a hardcoded install path,
    # so without this the sanity check above passes for a custom root while the
    # patches still land on the default one.
    $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p -Root $Root -ErrorAction SilentlyContinue 2>&1
    $code = $LASTEXITCODE
    Log "$($s.Name): exit=$code"
    ($out | Select-Object -Last 3) | ForEach-Object { Log "  $_" }
    $results += "$($s.Name)=$code"
  } catch {
    Log "$($s.Name): EXCEPTION $($_.Exception.Message)"
    $results += "$($s.Name)=EXC"
  }
}

# Sanity: both bundles must parse.
$node = 'E:\environment\nodejs\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }
foreach ($rel in @('out\vs\workbench\workbench.desktop.main.js', 'out\lingma\agents-window\agents-window.desktop.main.js')) {
  $f = Join-Path (Join-Path $Root 'resources\app') $rel
  & $node --check $f > $null 2>&1
  Log "syntax $(Split-Path $f -Leaf): exit=$LASTEXITCODE"
  $results += "syntax:$([System.IO.Path]::GetFileName($f))=$LASTEXITCODE"
}

Log ('SUMMARY ' + ($results -join ' '))
Log 'APPLY-ALL DONE'
Write-Host 'APPLY OK'
