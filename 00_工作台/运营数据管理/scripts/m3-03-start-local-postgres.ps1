param(
  [int]$Port = 55432,
  [string]$DatabaseName = "aiwei_m3_03_test",
  [string]$PostgresBinDir = "C:\Program Files\PostgreSQL\17\bin"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$tmpDir = Join-Path $projectDir "tmp"
$dataDir = Join-Path $tmpDir "m3-03-postgres-data"
$logPath = Join-Path $tmpDir "m3-03-postgres.log"
$envPath = Join-Path $tmpDir "m3-03-local-postgres.env"

$initdb = Join-Path $PostgresBinDir "initdb.exe"
$pgCtl = Join-Path $PostgresBinDir "pg_ctl.exe"
$psql = Join-Path $PostgresBinDir "psql.exe"

foreach ($path in @($initdb, $pgCtl, $psql)) {
  if (-not (Test-Path $path)) {
    throw "Required PostgreSQL binary not found: $path"
  }
}

New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null

if (-not (Test-Path (Join-Path $dataDir "PG_VERSION"))) {
  Write-Host "Initializing local PostgreSQL data directory: $dataDir"
  & $initdb -D $dataDir --username=postgres --auth=trust --encoding=UTF8
  if ($LASTEXITCODE -ne 0) {
    throw "initdb failed."
  }
}

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Starting local PostgreSQL on 127.0.0.1:$Port"
  & $pgCtl -D $dataDir -l $logPath -o "-p $Port -c listen_addresses=127.0.0.1" start
  if ($LASTEXITCODE -ne 0) {
    throw "pg_ctl start failed. See $logPath"
  }
} else {
  Write-Host "Port $Port is already listening; checking PostgreSQL readiness."
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1;" *> $null
  if ($LASTEXITCODE -eq 0) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 1
}

if (-not $ready) {
  throw "Local PostgreSQL did not become ready. See $logPath"
}

$exists = & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$DatabaseName';"
if (-not ($exists -match "1")) {
  & $psql -h 127.0.0.1 -p $Port -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $DatabaseName;"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create database $DatabaseName."
  }
}

$databaseUrl = "postgresql://postgres@127.0.0.1:$Port/$DatabaseName"
$envLines = @(
  "# Local-only M3-03 PostgreSQL rehearsal connection.",
  "# Uses trust auth on 127.0.0.1 and project-local data directory.",
  "# Do not commit this file.",
  "M3_03_PSQL_PATH=$psql",
  "M3_03_DATABASE_URL=$databaseUrl",
  "M3_03_PGDATA=$dataDir",
  "M3_03_PGLOG=$logPath"
)
Set-Content -Path $envPath -Value $envLines -Encoding UTF8

Write-Host "Local PostgreSQL is ready."
Write-Host "Database: $DatabaseName"
Write-Host "Port: $Port"
Write-Host "Connection details: $envPath"
