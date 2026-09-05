param(
  [string]$PackageId = "PostgreSQL.PostgreSQL.17",
  [int]$Port = 55432,
  [string]$DatabaseName = "aiwei_m3_03_test",
  [string]$ServiceName = "postgresql-x64-17-aiwei-test",
  [string]$InstallDir = "C:\Program Files\PostgreSQL\17",
  [string]$ExistingSuperPassword = "",
  [switch]$RunPreflightAfterInstall
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$tmpDir = Join-Path $projectDir "tmp"
$envPath = Join-Path $tmpDir "m3-03-local-postgres.env"

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

function New-LocalPassword {
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
  $bytes = New-Object byte[] 28
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $passwordChars = foreach ($byte in $bytes) {
    $chars[$byte % $chars.Length]
  }
  return -join $passwordChars
}

function Find-Psql {
  $command = Get-Command psql -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }

  $candidate = Join-Path $InstallDir "bin\psql.exe"
  if (Test-Path $candidate) { return $candidate }

  $fallbacks = @(
    "C:\Program Files\PostgreSQL\18\bin\psql.exe",
    "C:\Program Files\PostgreSQL\17\bin\psql.exe",
    "C:\Program Files\PostgreSQL\16\bin\psql.exe"
  )
  foreach ($path in $fallbacks) {
    if (Test-Path $path) { return $path }
  }

  return ""
}

function Invoke-PostgresCommand {
  param(
    [string]$PsqlPath,
    [string]$Password,
    [string]$Database,
    [string]$Sql
  )

  $env:PGPASSWORD = $Password
  & $PsqlPath -h 127.0.0.1 -p $Port -U postgres -d $Database -v ON_ERROR_STOP=1 -c $Sql
  if ($LASTEXITCODE -ne 0) {
    throw "psql command failed."
  }
}

$winget = Get-Command winget -ErrorAction SilentlyContinue
if (-not $winget) {
  throw "winget was not found. Install PostgreSQL manually or provide another package manager."
}

$psqlPath = Find-Psql
$password = if ([string]::IsNullOrWhiteSpace($ExistingSuperPassword)) { New-LocalPassword } else { $ExistingSuperPassword }

if (-not $psqlPath) {
  Write-Host "Installing $PackageId for local M3-03 rehearsal..."
  $override = "--mode unattended --unattendedmodeui none --superpassword $password --serverport $Port --servicename $ServiceName --disable-components stackbuilder"
  winget install -e --id $PackageId --silent --accept-package-agreements --accept-source-agreements --override $override
  if ($LASTEXITCODE -ne 0) {
    throw "winget install failed."
  }
  $psqlPath = Find-Psql
}

if (-not $psqlPath) {
  throw "PostgreSQL installation finished but psql.exe was not found."
}

Write-Host "Using psql: $psqlPath"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($service -and $service.Status -ne "Running") {
  Start-Service -Name $ServiceName
  Start-Sleep -Seconds 3
}

$databaseExistsSql = "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"
$env:PGPASSWORD = $password
$exists = & $psqlPath -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc $databaseExistsSql
if ($LASTEXITCODE -ne 0) {
  throw "Could not connect to local PostgreSQL on port $Port."
}

if (-not ($exists -match "1")) {
  Invoke-PostgresCommand -PsqlPath $psqlPath -Password $password -Database "postgres" -Sql "CREATE DATABASE $DatabaseName;"
}

$databaseUrl = "postgresql://postgres:$password@127.0.0.1:$Port/$DatabaseName"
$envLines = @(
  "# Local-only M3-03 PostgreSQL rehearsal connection.",
  "# Do not commit this file.",
  "M3_03_PSQL_PATH=$psqlPath",
  "M3_03_DATABASE_URL=$databaseUrl"
)
Set-Content -Path $envPath -Value $envLines -Encoding UTF8

Write-Host "Local PostgreSQL test database is ready."
Write-Host "Connection details were written to: $envPath"

if ($RunPreflightAfterInstall) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $scriptDir "m3-03-preflight-check.ps1") -DatabaseUrl $databaseUrl -PsqlPath $psqlPath
}
