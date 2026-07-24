param(
  [string]$TaskName = "AiweiLocalDbBackup",
  [string]$At = "13:30",
  [int]$RetentionDays = 10
)

$ErrorActionPreference = "Stop"

$ScriptPath = Join-Path $PSScriptRoot "local-backup-db.ps1"
if (-not (Test-Path -LiteralPath $ScriptPath)) {
  throw "local backup script not found: $ScriptPath"
}

$Argument = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptPath`" -RetentionDays $RetentionDays"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $Argument
$Trigger = New-ScheduledTaskTrigger -Daily -At $At
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$Settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Aiwei PostgreSQL local backup, keep local files for $RetentionDays days." -Force | Out-Null

Write-Output "installed task: $TaskName daily at $At retention_days=$RetentionDays"
