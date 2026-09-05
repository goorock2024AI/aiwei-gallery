param(
  [string]$DatabaseUrl = "",
  [string]$PsqlPath = "psql"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectDir = Split-Path -Parent $scriptDir
$sqlDir = Join-Path $projectDir "sql"
$serverPath = Join-Path $projectDir "server.js"
$appSqlPath = Join-Path $projectDir "app/sql/init.sql"
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$reportDir = Join-Path $projectDir "tmp"
$reportPath = Join-Path $reportDir "m3-03-preflight-$timestamp.md"

New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [string]$Status,
    [string]$Evidence,
    [string]$Impact
  )

  $checks.Add([pscustomobject]@{
    Name = $Name
    Status = $Status
    Evidence = $Evidence
    Impact = $Impact
  }) | Out-Null
}

function Test-CommandAvailable {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

$requiredSqlFiles = @(
  "20260903_m3_02_business_dimensions.sql",
  "20260903_m3_02_product_gallery_space_extensions.sql",
  "20260903_m3_02_business_fact_views.sql",
  "20260903_m3_02_validate.sql",
  "20260903_m3_02_rollback.sql"
)

foreach ($file in $requiredSqlFiles) {
  $path = Join-Path $sqlDir $file
  if (Test-Path $path) {
    Add-Check "SQL file: $file" "PASS" "File exists." "Can be used by M3-03 rehearsal."
  } else {
    Add-Check "SQL file: $file" "BLOCKER" "File missing." "Migration rehearsal cannot run."
  }
}

if (Test-Path $appSqlPath) {
  Add-Check "1.0 init SQL" "PASS" "app/sql/init.sql exists." "Can rebuild baseline schema before rehearsal."
} else {
  Add-Check "1.0 init SQL" "BLOCKER" "app/sql/init.sql missing." "Cannot establish baseline schema."
}

$hasPsql = Test-CommandAvailable $PsqlPath
$hasNode = Test-CommandAvailable "node"
$hasNodePg = Test-Path (Join-Path $projectDir "node_modules/pg")

if ($hasPsql) {
  Add-Check "psql client" "PASS" "$PsqlPath is available." "SQL rehearsal can run through PostgreSQL client."
} else {
  Add-Check "psql client" "WARN" "$PsqlPath is not available." "Use the Node rehearsal script if node_modules/pg is available."
}

if (Test-CommandAvailable "docker") {
  Add-Check "Docker" "PASS" "docker is available." "A disposable PostgreSQL rehearsal database can be created locally."
} else {
  Add-Check "Docker" "WARN" "docker is not available." "Use an existing local/test PostgreSQL database instead."
}

if ($hasNode) {
  Add-Check "Node.js" "PASS" "node is available." "Project scripts can run."
} else {
  Add-Check "Node.js" "BLOCKER" "node is not available." "Node-based rehearsal cannot run."
}

if ($hasNodePg) {
  Add-Check "Node pg dependency" "PASS" "node_modules/pg exists." "Node-based database helper scripts can connect if needed."
} else {
  Add-Check "Node pg dependency" "WARN" "node_modules/pg does not exist." "Run npm install only in a controlled dev setup if Node DB helpers are needed."
}

if ($hasPsql -or ($hasNode -and $hasNodePg)) {
  Add-Check "SQL runner" "PASS" "At least one SQL runner is available." "Use psql rehearsal script or Node rehearsal script."
} else {
  Add-Check "SQL runner" "BLOCKER" "No usable SQL runner found." "Install psql or prepare node_modules/pg before rehearsal."
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  Add-Check "Test database URL" "BLOCKER" "No DatabaseUrl supplied." "A local/test PostgreSQL database is required before executing rehearsal."
} else {
  $blockedPatterns = @("iwe.ucanart.cc", "122.51.56.50", "prod", "production")
  $looksProductionLike = $false
  foreach ($pattern in $blockedPatterns) {
    if ($DatabaseUrl -match [regex]::Escape($pattern)) {
      $looksProductionLike = $true
    }
  }
  if ($looksProductionLike) {
    Add-Check "Test database URL" "BLOCKER" "DatabaseUrl looks production-like. Value is not printed." "Do not run rehearsal against production."
  } else {
    Add-Check "Test database URL" "PASS" "DatabaseUrl supplied and does not match known production-like patterns. Value is not printed." "Can be used for controlled rehearsal."
  }
}

if (Test-Path $serverPath) {
  $serverText = Get-Content -Raw -Path $serverPath
  $v2Objects = @(
    "business_dimensions",
    "business_mapping_rules",
    "record_business_links",
    "product_aliases",
    "business_revenue_facts_v2",
    "business_cost_facts_v2",
    "business_profit_facts_v2"
  )

  foreach ($objectName in $v2Objects) {
    if ($serverText.Contains("'$objectName'") -or $serverText.Contains("`"$objectName`"")) {
      Add-Check "server.js object exposure: $objectName" "PASS" "Object name appears in server.js." "Static exposure may be present; runtime permission still needs testing."
    } else {
      Add-Check "server.js object exposure: $objectName" "WARN" "Object name not found in server.js." "API exposure/permission update is still needed after DB rehearsal."
    }
  }
} else {
  Add-Check "server.js" "BLOCKER" "server.js missing." "Cannot inspect API whitelist."
}

$passCount = @($checks | Where-Object { $_.Status -eq "PASS" }).Count
$warnCount = @($checks | Where-Object { $_.Status -eq "WARN" }).Count
$blockerCount = @($checks | Where-Object { $_.Status -eq "BLOCKER" }).Count

$summary = @{
  PASS = $passCount
  WARN = $warnCount
  BLOCKER = $blockerCount
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("# M3-03 Preflight Check") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("Generated at: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("DatabaseUrl is never printed by this report.") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("## Summary") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("- PASS: $($summary.PASS)") | Out-Null
$lines.Add("- WARN: $($summary.WARN)") | Out-Null
$lines.Add("- BLOCKER: $($summary.BLOCKER)") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("## Checks") | Out-Null
$lines.Add("") | Out-Null
$lines.Add("| Check | Status | Evidence | Impact |") | Out-Null
$lines.Add("|---|---|---|---|") | Out-Null
foreach ($check in $checks) {
  $lines.Add("| $($check.Name) | $($check.Status) | $($check.Evidence) | $($check.Impact) |") | Out-Null
}

Set-Content -Path $reportPath -Value $lines -Encoding UTF8

Write-Host "M3-03 preflight report: $reportPath"
Write-Host "PASS=$($summary.PASS) WARN=$($summary.WARN) BLOCKER=$($summary.BLOCKER)"

if ($summary.BLOCKER -gt 0) {
  Write-Host "Result: BLOCKED. Resolve BLOCKER items before migration rehearsal."
} else {
  if ($hasPsql) {
    Write-Host "Result: READY. Run scripts/m3-03-local-migration-rehearsal.ps1 against the local/test database."
  } else {
    Write-Host "Result: READY. Run npm run m3:rehearsal with AIWEI_TEST_DATABASE_URL set to the local/test database."
  }
}
