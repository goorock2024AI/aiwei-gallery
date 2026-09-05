param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [string]$PsqlPath = "psql",

  [switch]$ResetSchema,

  [switch]$SkipRollback,

  [switch]$AllowProductionLikeUrl
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$sqlDir = Join-Path $projectDir "sql"
$appSql = Join-Path $projectDir "app/sql/init.sql"

$blockedPatterns = @(
  "iwe.ucanart.cc",
  "122.51.56.50",
  "prod",
  "production"
)

if (-not $AllowProductionLikeUrl) {
  foreach ($pattern in $blockedPatterns) {
    if ($DatabaseUrl -match [regex]::Escape($pattern)) {
      throw "DatabaseUrl looks production-like. Use a local/test database, or pass -AllowProductionLikeUrl only after explicit approval."
    }
  }
}

$psqlCommand = Get-Command $PsqlPath -ErrorAction SilentlyContinue
if (-not $psqlCommand) {
  throw "psql was not found. Install PostgreSQL client tools or pass -PsqlPath with the full psql executable path."
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logDir = Join-Path $projectDir "tmp/m3-03-rehearsal-$timestamp"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [string]$FilePath
  )

  if (-not (Test-Path $FilePath)) {
    throw "Missing SQL file for $Label`: $FilePath"
  }

  $logPath = Join-Path $logDir "$Label.log"
  Write-Host "Running $Label ..."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $PsqlPath $DatabaseUrl -v ON_ERROR_STOP=1 -f $FilePath 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output | Tee-Object -FilePath $logPath
  if ($exitCode -ne 0) {
    throw "$Label failed. See $logPath"
  }
}

function Invoke-PsqlCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Label,

    [Parameter(Mandatory = $true)]
    [string]$Sql
  )

  $logPath = Join-Path $logDir "$Label.log"
  Write-Host "Running $Label ..."
  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & $PsqlPath $DatabaseUrl -v ON_ERROR_STOP=1 -c $Sql 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output | Tee-Object -FilePath $logPath
  if ($exitCode -ne 0) {
    throw "$Label failed. See $logPath"
  }
}

Write-Host "M3-03 local migration rehearsal started."
Write-Host "Logs: $logDir"
Write-Host "Database URL is intentionally not printed."

if ($ResetSchema) {
  Invoke-PsqlCommand -Label "00-reset-public-schema" -Sql "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;"
}

Invoke-PsqlFile -Label "00-init-1-0-schema" -FilePath $appSql
Invoke-PsqlFile -Label "01-business-dimensions" -FilePath (Join-Path $sqlDir "20260903_m3_02_business_dimensions.sql")
Invoke-PsqlFile -Label "02-product-gallery-space-extensions" -FilePath (Join-Path $sqlDir "20260903_m3_02_product_gallery_space_extensions.sql")
Invoke-PsqlFile -Label "03-business-fact-views" -FilePath (Join-Path $sqlDir "20260903_m3_02_business_fact_views.sql")
Invoke-PsqlFile -Label "04-validate" -FilePath (Join-Path $sqlDir "20260903_m3_02_validate.sql")

if (-not $SkipRollback) {
  Invoke-PsqlFile -Label "05-rollback" -FilePath (Join-Path $sqlDir "20260903_m3_02_rollback.sql")
  Invoke-PsqlFile -Label "06-reinit-after-rollback" -FilePath $appSql
}

Write-Host "M3-03 local migration rehearsal finished."
