param(
    [Parameter(Mandatory=$true)][string]$Task,
    [string[]]$TaskArgs = @()
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($projectRoot -notmatch '^[Dd]:\\') { throw 'CodeLeader 必须位于 D 盘。' }
$settings = @{
    npm_config_cache = "$projectRoot\.cache\npm"
    npm_config_userconfig = "$projectRoot\scripts\npmrc"
    ELECTRON_CACHE = "$projectRoot\.cache\electron"
    electron_config_cache = "$projectRoot\.cache\electron"
    ELECTRON_BUILDER_CACHE = "$projectRoot\.cache\builder"
    TEMP = "$projectRoot\.tmp"
    TMP = "$projectRoot\.tmp"
    TMPDIR = "$projectRoot\.tmp"
    PYTHONPYCACHEPREFIX = "$projectRoot\.cache\python"
    PLAYWRIGHT_BROWSERS_PATH = "$projectRoot\.cache\browsers"
    XDG_CACHE_HOME = "$projectRoot\.cache"
    CODELEADER_ROOT = $projectRoot
}
$previous = @{}
$previousLocation = Get-Location
try {
    foreach ($name in $settings.Keys) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process')
    }
    foreach ($folder in @('.tools','.cache\npm','.cache\electron','.cache\builder','.cache\maven','.tmp','.appdata','dist','release')) {
        & node (Join-Path $projectRoot 'scripts\check-managed-path.mjs') (Join-Path $projectRoot $folder)
        if ($LASTEXITCODE -ne 0) { throw "受控目录真实路径检查失败：$folder" }
        New-Item -ItemType Directory -Path (Join-Path $projectRoot $folder) -Force | Out-Null
    }
    Set-Location -LiteralPath $projectRoot
    if ($Task -eq 'install') { & npm.cmd install @TaskArgs }
    elseif ($Task -eq 'npm') { & npm.cmd @TaskArgs }
    elseif ($Task -eq 'node') { & node @TaskArgs }
    else { & npm.cmd run $Task -- @TaskArgs }
    if ($LASTEXITCODE -ne 0) { throw "任务 $Task 失败，退出码 $LASTEXITCODE" }
} finally {
    Set-Location -LiteralPath $previousLocation
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
