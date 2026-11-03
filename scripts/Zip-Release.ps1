param([string]$Source, [string]$Destination)
$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($Source)
$destinationPath = [IO.Path]::GetFullPath($Destination)
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\release')).TrimEnd('\') + '\'
if ($releaseRoot -notmatch '^[Dd]:\\' -or -not $sourcePath.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $destinationPath.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Release ZIP paths must stay inside the project release directory on D:.' }
foreach ($target in @($sourcePath, $destinationPath)) {
    & node (Join-Path $PSScriptRoot 'check-managed-path.mjs') $target
    if ($LASTEXITCODE -ne 0) { throw 'Release path failed the managed-path check.' }
}
$items = Get-ChildItem -LiteralPath $sourcePath -Force | Where-Object { $_.Name -ne 'data' } | Select-Object -ExpandProperty FullName
Compress-Archive -LiteralPath $items -DestinationPath $destinationPath -CompressionLevel Optimal
