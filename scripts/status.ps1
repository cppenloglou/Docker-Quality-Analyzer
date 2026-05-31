Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
Initialize-ComposeContext @args

$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3000" }

Write-Host "[status] docker compose services"
Invoke-ComposeChecked ps
Write-Host ""
Write-Host "[status] mode: $script:Mode"
Write-Host ""

if ($script:Mode -eq "dev") {
  Write-Host "[status] api health (compose network)"
  $apiHealth = & docker @(Get-ComposeArgs) @("exec", "-T", "api", "sh", "-lc", "curl -fsS http://127.0.0.1:8000/health") 2>$null
  if ($LASTEXITCODE -eq 0) {
    $apiHealth
    Write-Host ""
  }
  else {
    Write-Host "API not healthy in compose network"
  }
}
else {
  Write-Host "[status] api health (via frontend proxy)"
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort/health" -Method Get -TimeoutSec 10
    $response.Content
    Write-Host ""
  }
  catch {
    Write-Host "API proxy health not reachable via frontend"
  }
}

Write-Host ""
Write-Host "[status] frontend"
try {
  Invoke-WebRequest -Uri "http://127.0.0.1:$frontendPort" -Method Get -TimeoutSec 10 | Out-Null
  Write-Host "Frontend reachable at http://127.0.0.1:$frontendPort"
}
catch {
  Write-Host "Frontend not reachable"
}
