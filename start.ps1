#Requires -Version 5.1
<#
  Qoder BYOK 一键启动 / 停止 / 查状态

  用法（任选其一）：
    双击 start.cmd
    powershell -ExecutionPolicy Bypass -File start.ps1
    powershell -ExecutionPolicy Bypass -File start.ps1 -Status
    powershell -ExecutionPolicy Bypass -File start.ps1 -Stop
    powershell -ExecutionPolicy Bypass -File start.ps1 -Open      # 启动后打开控制台

  它只负责起两个后台服务，不改 Qoder 的任何配置：
    控制台  admin.js   http://127.0.0.1:3426
    代理    proxy.js   127.0.0.1:8788

  注意：本文件是带 BOM 的 UTF-8，这样 PowerShell 5.1 才能正确读中文。
#>
param(
  [switch]$Stop,
  [switch]$Status,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$ProxyDir = Join-Path $Root 'qoder-proxy'
$LogDir = Join-Path $Root '_start_logs'

$Services = @(
  [pscustomobject]@{ Name = '控制台'; File = 'admin.js'; Port = 3426; Url = 'http://127.0.0.1:3426/' },
  [pscustomobject]@{ Name = '代理';   File = 'proxy.js'; Port = 8788; Url = $null }
)

function Test-Port([int]$Port) {
  $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return [bool]$c
}

function Get-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @(
      (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe'),
      'E:\environment\nodejs\node.exe'
    )) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

function Get-ServiceProcess([string]$File) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($File) -and $_.CommandLine -match 'qoder-proxy' }
}

function Show-Status {
  Write-Host ''
  Write-Host '服务状态' -ForegroundColor Cyan
  foreach ($s in $Services) {
    $up = Test-Port $s.Port
    $line = '  {0,-8} 端口 {1}  {2}' -f $s.Name, $s.Port, $(if ($up) { '运行中' } else { '未启动' })
    Write-Host $line -ForegroundColor $(if ($up) { 'Green' } else { 'Yellow' })
  }
  # 顺带问一下控制台，把补丁/代理/证书状态带出来
  if (Test-Port 3426) {
    try {
      $st = Invoke-RestMethod 'http://127.0.0.1:3426/api/status' -TimeoutSec 10
      $p = $st.patches
      Write-Host ('  补丁      byok={0} experts={1} live={2} repowiki={3}' -f $p.byok, $p.experts, $p.live, $p.repowiki)
      Write-Host ('  证书      已信任={0}' -f $st.cert.trusted)
      Write-Host ('  IDE代理   {0}' -f $(if ($st.ide.httpProxy) { $st.ide.httpProxy } else { '未设置' }))
      Write-Host ('  上游      {0}  {1}' -f $st.config.upstream.baseUrl, $st.config.upstream.model)
    } catch {
      Write-Host '  （控制台已监听但状态接口没响应，稍等几秒再看）' -ForegroundColor Yellow
    }
  }
  Write-Host ''
}

function Start-All {
  if (-not (Test-Path -LiteralPath (Join-Path $ProxyDir 'admin.js'))) {
    Write-Host ('找不到 ' + $ProxyDir + '\admin.js，本脚本要和 qoder-proxy 放在同一个目录') -ForegroundColor Red
    exit 1
  }
  $node = Get-NodeExe
  if (-not $node) {
    Write-Host '找不到 node.exe：请先安装 Node.js，或把它加入 PATH。' -ForegroundColor Red
    exit 1
  }
  if (-not (Test-Path -LiteralPath $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

  Write-Host ''
  Write-Host '启动 Qoder BYOK 服务' -ForegroundColor Cyan
  Write-Host ('  node: ' + $node)

  foreach ($s in $Services) {
    if (Test-Port $s.Port) {
      Write-Host ('  {0,-8} 端口 {1} 已在运行，跳过' -f $s.Name, $s.Port) -ForegroundColor DarkGray
      continue
    }
    $script = Join-Path $ProxyDir $s.File
    $out = Join-Path $LogDir ($s.Name + '.out.log')
    $err = Join-Path $LogDir ($s.Name + '.err.log')
    Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory $ProxyDir -WindowStyle Hidden `
      -RedirectStandardOutput $out -RedirectStandardError $err | Out-Null
    Write-Host ('  {0,-8} 启动中…' -f $s.Name)
  }

  # 等端口起来（代理要先加载证书，给足时间）
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline) {
    $allUp = $true
    foreach ($s in $Services) { if (-not (Test-Port $s.Port)) { $allUp = $false } }
    if ($allUp) { break }
    Start-Sleep -Milliseconds 700
  }

  $failed = @()
  foreach ($s in $Services) { if (-not (Test-Port $s.Port)) { $failed += $s } }

  if ($failed.Count) {
    Write-Host ''
    Write-Host '有服务没起来：' -ForegroundColor Red
    foreach ($s in $failed) {
      Write-Host ('  ' + $s.Name + '（端口 ' + $s.Port + '）') -ForegroundColor Red
      $err = Join-Path $LogDir ($s.Name + '.err.log')
      if (Test-Path -LiteralPath $err) {
        Get-Content -LiteralPath $err -Tail 12 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ('    ' + $_) }
      }
    }
    Write-Host ('  完整日志在 ' + $LogDir) -ForegroundColor DarkGray
    exit 1
  }

  Show-Status
  Write-Host ('控制台：' + $Services[0].Url) -ForegroundColor Green
  if ($Open) { Start-Process $Services[0].Url }
}

function Stop-All {
  Write-Host ''
  Write-Host '停止 Qoder BYOK 服务' -ForegroundColor Cyan
  $any = $false
  foreach ($s in $Services) {
    $procs = @(Get-ServiceProcess $s.File)
    if (-not $procs.Count) {
      Write-Host ('  {0,-8} 没在运行' -f $s.Name) -ForegroundColor DarkGray
      continue
    }
    foreach ($p in $procs) {
      try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop; $any = $true; Write-Host ('  {0,-8} 已停止（PID {1}）' -f $s.Name, $p.ProcessId) }
      catch { Write-Host ('  {0,-8} 停止失败：{1}' -f $s.Name, $_.Exception.Message) -ForegroundColor Red }
    }
  }
  Start-Sleep -Milliseconds 800
  Show-Status
  if (-not $any) { Write-Host '（本来就没在跑）' -ForegroundColor DarkGray }
}

if ($Stop) { Stop-All; exit 0 }
if ($Status) { Show-Status; exit 0 }
Start-All
