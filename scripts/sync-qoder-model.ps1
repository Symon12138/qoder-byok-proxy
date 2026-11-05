#Requires -Version 5.1
# Sync the Qoder custom-model record with the upstream gateway metadata.
# Reads qoder-proxy/config.json (upstream.baseUrl / apiKey / model), queries
# /v1/models, and rewrites aicoding.customModels so the IDE shows the right
# display name, context window, vision flag and reasoning levels.
param(
  [string]$ProxyDir = (Join-Path $PSScriptRoot '..\qoder-proxy'),
  [string]$Id = 'model_mocktest'
)

$ErrorActionPreference = 'Stop'
$cfg = Get-Content (Join-Path $ProxyDir 'config.json') -Raw | ConvertFrom-Json
$up = $cfg.upstream
$base = $up.baseUrl.TrimEnd('/')
Write-Output "gateway: $base  model: $($up.model)"

$headers = @{ Authorization = 'Bearer ' + $up.apiKey }
$models = (Invoke-RestMethod -Uri "$base/models" -Headers $headers -TimeoutSec 30).data
$m = $models | Where-Object { $_.id -eq $up.model } | Select-Object -First 1
if (-not $m) { throw "model $($up.model) not found on gateway" }

if ($up.displayName) {
  # 用户在控制台显式设的显示名，原样使用，不做任何"美化"
  $displayName = $up.displayName
} else {
  # 网关返回的可能是原始 id 片段（如 "cn:deepseek-v4.1-flash"），取最后一段更好读
  $displayName = if ($m.display_name) { $m.display_name } else { $m.id }
  if ($displayName -match '^[a-z]+:' -or $displayName.Contains('/')) {
    $displayName = ($m.id -split '[:/]')[-1]
  }
}
$maxInput = if ($m.max_input_tokens) { [int64]$m.max_input_tokens } else { 128000 }
# 输出上限：控制台配的 maxTokens 优先，其次网关报的 max_output_tokens
$maxOutput = if ($up.maxTokens) { [int64]$up.maxTokens } elseif ($m.max_output_tokens) { [int64]$m.max_output_tokens } else { 0 }
$isVl = ($m.modalities.input -contains 'image')
$isReasoning = [bool]$m.reasoning
$levels = @($m.reasoning_levels | Where-Object { $_ })

$efforts = [ordered]@{}
if ($levels.Count -gt 0) {
  # 默认思考档位：控制台「上游配置 → 思考等级」选的优先（前提是该模型支持这一档），
  # 否则退回网关给的第一档。以前一律用第一档，导致控制台的选择完全无效。
  $default = if ($up.reasoningEffort -and ($levels -contains $up.reasoningEffort)) {
    $up.reasoningEffort
  } else {
    $levels[0]
  }
  foreach ($l in $levels) {
    $efforts[$l] = @{
      display_name = @{ cn_zh = $l; en_us = $l }
      isDefault    = ($l -eq $default)
    }
  }
}

$record = [ordered]@{
  id                  = $Id
  provider            = 'deepseek'
  providerDisplayName = 'DeepSeek'
  model               = 'local-model'
  displayName         = $displayName
  baseUrl             = $up.baseUrl
  apiKey              = $up.apiKey
  visible             = $true
  hasApiKey           = $true
  is_vl               = $isVl
  is_reasoning        = $isReasoning
  max_input_tokens    = $maxInput
  reasoningLabel      = '思考等级'
  createTime          = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}
if ($maxOutput -gt 0) { $record.max_output_tokens = $maxOutput }

if ($efforts.Count -gt 0) {
  $record.thinkingConfig = @{
    enabled  = @{ isDefault = $true; defaultEffortKey = $default; efforts = $efforts }
    disabled = @{ isDefault = $false }
  }
}

$json = '[' + ($record | ConvertTo-Json -Depth 8 -Compress) + ']'
$esc = $json.Replace("'", "''")
$db = Join-Path $env:APPDATA 'Qoder\User\globalStorage\state.vscdb'
$sqlite = (Get-Command sqlite3 -ErrorAction SilentlyContinue).Source
if (-not $sqlite) { $sqlite = 'C:\Users\Administrator\scoop\shims\sqlite3.exe' }
"UPDATE ItemTable SET value = CAST('$esc' AS TEXT) WHERE key='aicoding.customModels';" | & $sqlite $db

Write-Output "record updated:"
Write-Output ("  displayName       = {0}" -f $displayName)
Write-Output ("  max_input_tokens  = {0}" -f $maxInput)
Write-Output ("  is_vl             = {0}" -f $isVl)
Write-Output ("  is_reasoning      = {0}  levels={1}" -f $isReasoning, ($levels -join ','))
Write-Output ("  max_output_tokens = {0}" -f $maxOutput)
Write-Output 'Restart Qoder IDE to reload the model list.'
