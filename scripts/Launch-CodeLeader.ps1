$ErrorActionPreference = 'Stop'
$applicationRoot = [IO.Path]::GetFullPath($PSScriptRoot)
if ($applicationRoot -notmatch '^[Dd]:\\') { throw 'Extract CodeLeader into a writable folder on drive D.' }
$dataPath = Join-Path $applicationRoot 'data'
if (Test-Path -LiteralPath $dataPath) {
    $links = @((Get-Item -LiteralPath $dataPath)) + @(Get-ChildItem -LiteralPath $dataPath -Recurse -Force)
    if ($links | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Application data must not contain directory junctions or symbolic links.' }
}
foreach ($folder in @('config','session','logs','crashes','temp')) { New-Item -ItemType Directory -Path (Join-Path $dataPath $folder) -Force | Out-Null }
$probePath = Join-Path $dataPath 'temp\launcher-write-probe'
[IO.File]::WriteAllText($probePath, 'ok')
Remove-Item -LiteralPath $probePath
$previous = @{}
foreach ($name in @('TEMP','TMP','TMPDIR','ELECTRON_RUN_AS_NODE')) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
    $env:TEMP = Join-Path $dataPath 'temp'
    $env:TMP = $env:TEMP
    $env:TMPDIR = $env:TEMP
    Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
    $userDataArgument = '--user-data-dir="' + (Join-Path $dataPath 'config') + '"'
    $cacheArgument = '--disk-cache-dir="' + (Join-Path $dataPath 'session\Cache') + '"'
    Start-Process -FilePath (Join-Path $applicationRoot 'CodeLeader.exe') -ArgumentList @($userDataArgument,$cacheArgument) -WorkingDirectory $applicationRoot -WindowStyle Hidden
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
