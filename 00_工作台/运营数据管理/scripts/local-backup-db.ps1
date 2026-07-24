param(
  [string]$Server = "122.51.56.50",
  [string]$User = "root",
  [string]$RemoteAppDir = "/opt/aiwei",
  [string]$LocalBackupDir = "",
  [int]$RetentionDays = 10
)

$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $PSScriptRoot
if (-not $LocalBackupDir) {
  $LocalBackupDir = Join-Path $AppDir "local-backups\postgres"
}
$LogDir = Join-Path $AppDir "local-backups\logs"
$LockPath = Join-Path $env:TEMP "aiwei-local-db-backup.lock"

New-Item -ItemType Directory -Force -Path $LocalBackupDir, $LogDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = Join-Path $LogDir "local-backup-$timestamp.log"

function Write-BackupLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
  $line | Tee-Object -FilePath $LogFile -Append
}

$lockStream = $null
try {
  $lockStream = [System.IO.File]::Open($LockPath, "OpenOrCreate", "ReadWrite", "None")

  Write-BackupLog "local backup started"
  Write-BackupLog "server=$Server remote_app_dir=$RemoteAppDir local_backup_dir=$LocalBackupDir retention_days=$RetentionDays"

  $remoteCommand = "cd $RemoteAppDir && bash scripts/backup-db.sh >/dev/null && ls -1 backups/postgres/*.dump | sort | tail -1"
  $remoteLatest = (& ssh.exe -o ConnectTimeout=20 "$User@$Server" $remoteCommand 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "remote backup command failed: $remoteLatest"
  }

  $remoteRelative = ($remoteLatest | Select-Object -Last 1).Trim()
  if (-not $remoteRelative -or -not $remoteRelative.EndsWith(".dump")) {
    throw "remote backup path is invalid: $remoteRelative"
  }

  $backupName = Split-Path -Leaf $remoteRelative
  $localDump = Join-Path $LocalBackupDir $backupName
  $localManifest = "$localDump.manifest"
  $localSha = "$localDump.sha256"
  $remoteDump = "$RemoteAppDir/$remoteRelative"
  $remoteManifest = "$remoteDump.manifest"
  $remoteSha = "$remoteDump.sha256"

  Write-BackupLog "downloading $remoteDump"
  & scp.exe -o ConnectTimeout=20 "$User@$Server`:$remoteDump" "$localDump" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "scp dump failed" }

  & scp.exe -o ConnectTimeout=20 "$User@$Server`:$remoteManifest" "$localManifest" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "scp manifest failed" }

  $remoteShaText = (& ssh.exe -o ConnectTimeout=20 "$User@$Server" "cat $remoteSha" 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "read remote sha256 failed: $remoteShaText" }
  $remoteHash = (($remoteShaText | Select-Object -First 1) -split "\s+")[0].ToLowerInvariant()
  $localHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $localDump).Hash.ToLowerInvariant()
  if ($remoteHash -ne $localHash) {
    throw "sha256 mismatch: remote=$remoteHash local=$localHash"
  }

  "$localHash  $localDump" | Set-Content -LiteralPath $localSha -Encoding ASCII
  Add-Content -LiteralPath $localManifest -Encoding UTF8 -Value @(
    "local_downloaded_at=$(Get-Date -Format o)",
    "local_file=$localDump",
    "local_sha256=$localHash",
    "local_retention_days=$RetentionDays"
  )

  $cutoff = (Get-Date).AddDays(-$RetentionDays)
  Get-ChildItem -LiteralPath $LocalBackupDir -File -Filter "aiwei-postgres-*.dump" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    ForEach-Object {
      $base = $_.FullName
      Remove-Item -LiteralPath $base -Force
      Remove-Item -LiteralPath "$base.sha256" -Force -ErrorAction SilentlyContinue
      Remove-Item -LiteralPath "$base.manifest" -Force -ErrorAction SilentlyContinue
      Write-BackupLog "removed expired backup $base"
    }

  Get-ChildItem -LiteralPath $LogDir -File -Filter "local-backup-*.log" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force

  $size = (Get-Item -LiteralPath $localDump).Length
  Write-BackupLog "local backup completed: $localDump ($size bytes)"
}
finally {
  if ($lockStream) { $lockStream.Dispose() }
}
