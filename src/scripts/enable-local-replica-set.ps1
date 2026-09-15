param(
  [string]$ConfigPath = 'C:\Program Files\MongoDB\Server\8.3\bin\mongod.cfg',
  [string]$ServiceName = 'MongoDB'
)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).Path
$configText = [System.IO.File]::ReadAllText($configFile)
if ($configText -match '(?m)^replication\s*:' -and $configText -notmatch '(?m)^\s+replSetName:\s*rs0\s*$') {
  throw 'An active replication section already exists. Inspect it before changing this configuration.'
}
if ($configText -notmatch '(?m)^\s+bindIp:\s*127\.0\.0\.1\s*$') {
  throw 'This helper only configures a localhost-only development MongoDB service.'
}
if ($configText -notmatch '(?m)^replication\s*:') {
$configBackup = "$configFile.crl-backup-$(Get-Date -Format 'yyyyMMddHHmmss')"
Copy-Item -LiteralPath $configFile -Destination $configBackup
try {
  [System.IO.File]::WriteAllText($configFile, $configText + "`r`nreplication:`r`n  replSetName: rs0`r`n", [System.Text.UTF8Encoding]::new($false))
  Restart-Service -Name $ServiceName -ErrorAction Stop
  (Get-Service -Name $ServiceName).WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  Write-Output "MongoDB replica-set mode enabled. Original configuration: $configBackup"
} catch {
  Copy-Item -LiteralPath $configBackup -Destination $configFile -Force
  Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
  throw
}
}
& node (Join-Path $PSScriptRoot 'init-local-replica-set.js')
if ($LASTEXITCODE -ne 0) { throw 'MongoDB replica-set initialization failed.' }
