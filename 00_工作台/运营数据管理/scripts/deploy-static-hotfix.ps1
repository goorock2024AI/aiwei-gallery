param(
  [Parameter(Mandatory = $true)]
  [string]$Token,

  [Parameter(Mandatory = $true)]
  [string[]]$Files,

  [string]$RemoteHost = "root@122.51.56.50",
  [string]$RemoteRoot = "/opt/aiwei",
  [string]$SiteUrl = "https://iwe.ucanart.cc",
  [string]$BackupTag = "frontend-static-hotfix"
)

$ErrorActionPreference = "Stop"

function Invoke-Step($Name, [scriptblock]$Block) {
  Write-Host ""
  Write-Host "== $Name =="
  & $Block
}

function Assert-AppRelativeFile($File) {
  if ($File -match "^\s*$") {
    throw "Empty file path is not allowed."
  }
  if ($File -match "^[A-Za-z]:|^/|^\.\.|\\\.\.") {
    throw "Use app-relative paths only, for example index.html or js/charts.js: $File"
  }
  $local = Join-Path "app" $File
  if (!(Test-Path -LiteralPath $local -PathType Leaf)) {
    throw "Local file does not exist: $local"
  }
  return $local
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = "$RemoteRoot/backups/$BackupTag-$timestamp"

Invoke-Step "Preflight" {
  Write-Host "Token: $Token"
  Write-Host "Backup: $backupDir"
  foreach ($file in $Files) {
    $local = Assert-AppRelativeFile $file
    $item = Get-Item -LiteralPath $local
    Write-Host "$file -> $($item.Length) bytes"
  }
}

Invoke-Step "Create remote backup" {
  ssh $RemoteHost "mkdir -p '$backupDir'"
  foreach ($file in $Files) {
    $remoteFile = "$RemoteRoot/app/$file"
    $backupName = $file -replace "[/\\]", "_"
    ssh $RemoteHost "cp '$remoteFile' '$backupDir/$backupName'"
  }
  ssh $RemoteHost "ls -la '$backupDir'"
}

Invoke-Step "Upload files" {
  foreach ($file in $Files) {
    $local = Assert-AppRelativeFile $file
    $remoteFile = "$RemoteRoot/app/$file"
    scp $local "${RemoteHost}:$remoteFile"
    ssh $RemoteHost "stat -c '%n %s %y' '$remoteFile'"
  }
}

Invoke-Step "Verify HTTPS assets" {
  $homeResponse = Invoke-WebRequest -UseBasicParsing "$SiteUrl/?v=$Token"
  Write-Host "html $($homeResponse.StatusCode) $($homeResponse.Content.Length) token=$($homeResponse.Content.Contains($Token))"
  if (!$homeResponse.Content.Contains($Token)) {
    throw "Entry HTML does not contain token: $Token"
  }

  foreach ($file in $Files) {
    if ($file -eq "index.html") { continue }
    $url = "$SiteUrl/$file" + "?v=$Token"
    $res = Invoke-WebRequest -UseBasicParsing $url
    Write-Host "$file $($res.StatusCode) $($res.Content.Length)"
  }
}

Invoke-Step "Verify APIs and logs" {
  foreach ($endpoint in @("revenue_facts", "revenue")) {
    $res = Invoke-WebRequest -UseBasicParsing "$SiteUrl/rest/v1/$endpoint`?limit=1"
    Write-Host "$endpoint $($res.StatusCode) $($res.Content.Length)"
  }
  ssh $RemoteHost "cd '$RemoteRoot' && docker compose ps && docker compose logs api --tail=8"
}

Write-Host ""
Write-Host "Static hotfix deployed."
Write-Host "Rollback backup: $backupDir"
