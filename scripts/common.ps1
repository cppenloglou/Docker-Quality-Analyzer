Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:RootDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location $script:RootDir

function Initialize-ComposeContext {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ScriptArgs
  )

  $script:Mode = if ($env:MODE) { $env:MODE } else { "dev" }
  $script:ProfileArgs = @()

  foreach ($arg in $ScriptArgs) {
    switch ($arg) {
      "--dev" { $script:Mode = "dev" }
      "--prod" { $script:Mode = "prod" }
      "--tools" { $script:ProfileArgs += @("--profile", "tools") }
      default { }
    }
  }

  if (($script:Mode -ne "dev") -and ($script:Mode -ne "prod")) {
    throw "[scripts][error] MODE must be 'dev' or 'prod'"
  }

  $script:ComposeFiles = @("compose.yaml")
  if ($script:Mode -eq "dev") {
    $script:ComposeFiles += "compose.dev.yaml"
  }
  else {
    $script:ComposeFiles += "compose.prod.yaml"
  }
}

function Get-ComposeArgs {
  $args = @("compose", "--env-file", ".env")
  foreach ($composeFile in $script:ComposeFiles) {
    $args += @("-f", $composeFile)
  }
  $args += $script:ProfileArgs
  return $args
}

function Invoke-ComposeChecked {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs
  )

  & docker @(Get-ComposeArgs) @ComposeArgs
  if ($LASTEXITCODE -ne 0) {
    throw "[scripts][error] docker compose command failed."
  }
}

function Test-ComposeCommand {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ComposeArgs
  )

  & docker @(Get-ComposeArgs) @ComposeArgs *> $null
  return ($LASTEXITCODE -eq 0)
}

function Require-Command {
  param([Parameter(Mandatory = $true)][string]$CommandName)

  if (-not (Get-Command -Name $CommandName -ErrorAction SilentlyContinue)) {
    throw "[scripts][error] Missing required command: $CommandName"
  }
}

function New-SecretValue {
  param([int]$Length = 48)

  $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  $chars = New-Object char[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()

  try {
    $bytes = New-Object byte[] $Length
    $rng.GetBytes($bytes)
    for ($i = 0; $i -lt $Length; $i++) {
      $chars[$i] = $alphabet[$bytes[$i] % $alphabet.Length]
    }
  }
  finally {
    $rng.Dispose()
  }

  return -join $chars
}
