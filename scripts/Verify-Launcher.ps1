$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$applicationRoot = Join-Path $projectRoot 'release\win-unpacked'
$applicationPath = Join-Path $applicationRoot 'CodeLeader.exe'
$beforeTemp = $env:TEMP
$beforeTmp = $env:TMP
$beforeNode = $env:ELECTRON_RUN_AS_NODE
$startedAt = Get-Date
& (Join-Path $applicationRoot 'Launch-CodeLeader.ps1')
if ($env:TEMP -ne $beforeTemp -or $env:TMP -ne $beforeTmp -or $env:ELECTRON_RUN_AS_NODE -ne $beforeNode) { throw 'Launcher did not restore caller environment.' }
$applicationProcess = $null
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $applicationProcess = Get-Process -Name 'CodeLeader' -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $applicationPath -and $_.StartTime -ge $startedAt -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($applicationProcess) { break }
    Start-Sleep -Milliseconds 200
}
if (-not $applicationProcess) { throw 'Launcher did not create a visible application window.' }
$applicationProcessId = $applicationProcess.Id
if (-not $applicationProcess.CloseMainWindow()) { throw 'Application did not accept normal window close.' }
if (-not $applicationProcess.WaitForExit(8000)) { throw 'Application did not exit after closing its window.' }
@{ launcher = $applicationPath; processId = $applicationProcessId; environmentRestored = $true; normalClose = $true } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $projectRoot '.tmp\verification-packaged\launcher.json') -Encoding UTF8
