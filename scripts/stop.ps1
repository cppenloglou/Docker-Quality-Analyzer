Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "common.ps1")
Initialize-ComposeContext @args

$wipe = $args -contains "--wipe"

if ($wipe) {
  Write-Host "[stop] Stopping $script:Mode stack and removing volumes"
  Invoke-ComposeChecked down -v --remove-orphans
  if ($script:Mode -eq "dev") {
    Clear-DevUploadStorage
  }
}
else {
  Write-Host "[stop] Stopping $script:Mode stack"
  Invoke-ComposeChecked down --remove-orphans
}
