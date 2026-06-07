Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
Initialize-ComposeContext @args

function Write-StartLog {
  param([string]$Message)
  Write-Host "[start] $Message"
}

function Wait-Http {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [Parameter(Mandatory = $true)][string]$Name,
    [int]$TimeoutSeconds = 120
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 10 | Out-Null
      Write-StartLog "$Name is healthy at $Url"
      return
    }
    catch {
      Start-Sleep -Seconds 2
    }
  }

  throw "[start][error] Timed out waiting for $Name at $Url"
}

function Wait-Postgres {
  param([int]$TimeoutSeconds = 120)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ComposeCommand @("exec", "-T", "postgres", "sh", "-lc", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"')) {
      Write-StartLog "Postgres is ready"
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "[start][error] Timed out waiting for Postgres readiness"
}

function Wait-ApiContainer {
  param([int]$TimeoutSeconds = 120)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-ComposeCommand @("exec", "-T", "api", "sh", "-lc", 'curl -fsS http://127.0.0.1:8000/health >/dev/null')) {
      Write-StartLog "API is healthy in container network"
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "[start][error] Timed out waiting for API container health"
}

function Ensure-EnvFile {
  if (Test-Path ".env") {
    return
  }

  if (Test-Path ".env.example") {
    Copy-Item -Path ".env.example" -Destination ".env"
    Write-StartLog "Created .env from .env.example"
    return
  }

  @"
COMPOSE_PROJECT_NAME=docker-platform
APP_ENV=dev
POSTGRES_USER=postgres
POSTGRES_DB=docker_platform
API_PORT=8000
FRONTEND_PORT=3000
ADMINER_PORT=8080
VITE_API_BASE_URL=
"@ | Set-Content -Path ".env" -Encoding ascii
  Write-StartLog "Created minimal .env"
}

function Ensure-SecretFile {
  param(
    [Parameter(Mandatory = $true)][string]$TargetPath,
    [Parameter(Mandatory = $true)][string]$ExamplePath
  )

  if (Test-Path $TargetPath) {
    return
  }

  $parentDir = Split-Path -Path $TargetPath -Parent
  if (-not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir | Out-Null
  }

  if (Test-Path $ExamplePath) {
    Copy-Item -Path $ExamplePath -Destination $TargetPath
  }
  else {
    New-SecretValue | Set-Content -Path $TargetPath -Encoding ascii
  }

  Write-StartLog "Created missing secret file: $TargetPath"
}

function Invoke-Migrations {
  $migrationLog = [System.IO.Path]::GetTempFileName()
  $migrateCommand = @(
    "exec", "-T", "-w", "/app", "api", "sh", "-lc",
    'export POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"; export DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-docker_platform}"; PYTHONPATH=/app alembic upgrade head'
  )

  try {
    & docker @(Get-ComposeArgs) @migrateCommand *> $migrationLog
    if ($LASTEXITCODE -eq 0) {
      Write-StartLog "Migrations are up to date"
      return
    }

    $logContents = Get-Content -Path $migrationLog -Raw
    if ($logContents -match "(?i)(duplicate|already exists|DuplicateTable)") {
      Write-StartLog "Detected existing schema without Alembic state; stamping head then retrying"

      $stampCommand = @(
        "exec", "-T", "-w", "/app", "api", "sh", "-lc",
        'export POSTGRES_PASSWORD="$(cat /run/secrets/postgres_password)"; export DATABASE_URL="postgresql+asyncpg://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-docker_platform}"; PYTHONPATH=/app alembic stamp head'
      )

      & docker @(Get-ComposeArgs) @stampCommand *>> $migrationLog
      & docker @(Get-ComposeArgs) @migrateCommand *>> $migrationLog
      if ($LASTEXITCODE -ne 0) {
        throw "[start][error] Migration bootstrap failed. Logs:`n$(Get-Content -Path $migrationLog -Raw)"
      }

      Write-StartLog "Migration bootstrap completed"
      return
    }

    throw "[start][error] Migration failed. Logs:`n$logContents"
  }
  finally {
    Remove-Item -Path $migrationLog -ErrorAction SilentlyContinue
  }
}

Require-Command docker
if (-not (Get-Command -Name curl -ErrorAction SilentlyContinue)) {
  Write-StartLog "curl not found on host, using PowerShell HTTP checks"
}

& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "[start][error] Docker Compose v2 is required (docker compose ...)"
}

Ensure-EnvFile
Ensure-SecretFile -TargetPath "secrets/postgres_password.txt" -ExamplePath "secrets/postgres_password.txt.example"
Ensure-SecretFile -TargetPath "secrets/jwt_secret.txt" -ExamplePath "secrets/jwt_secret.txt.example"

Write-StartLog "Starting stack in mode: $script:Mode"
Invoke-ComposeChecked up -d --build

Write-StartLog "Waiting for Postgres"
Wait-Postgres -TimeoutSeconds 180

Write-StartLog "Running migrations"
Invoke-Migrations

$frontendPort = if ($env:FRONTEND_PORT) { $env:FRONTEND_PORT } else { "3000" }
Wait-Http -Url "http://127.0.0.1:$frontendPort" -Name "Frontend" -TimeoutSeconds 180

if ($script:Mode -eq "dev") {
  Wait-ApiContainer -TimeoutSeconds 180
  Write-Host "UI (dev):      http://127.0.0.1:$frontendPort"
  Write-Host "API (network): http://api:8000 (inside compose network)"
}
else {
  Wait-Http -Url "http://127.0.0.1:$frontendPort/health" -Name "API via frontend proxy" -TimeoutSeconds 180
  Write-Host "UI (prod-like): http://127.0.0.1:$frontendPort"
  Write-Host "API is available through frontend proxy routes"
}

Write-Host "Use .\scripts\status.ps1 --$script:Mode for runtime status"
if ($script:Mode -eq "dev") {
  Write-Host "Use .\scripts\stop.ps1 --$script:Mode --wipe to reset volumes and backend/storage/uploads"
}
else {
  Write-Host "Use .\scripts\stop.ps1 --$script:Mode --wipe to reset volumes"
}
