param([Parameter(Mandatory=$true)][int]$RootPid,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Continue'
$known=@{$RootPid=$true}
$system=@('MsMpEng.exe','SearchIndexer.exe','explorer.exe')
while($true){
 $start=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
 try{
  $all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,PrivatePageCount,HandleCount,ThreadCount,ReadTransferCount,WriteTransferCount,ReadOperationCount,WriteOperationCount)
  $changed=$true
  while($changed){$changed=$false;foreach($p in $all){if($known.ContainsKey([int]$p.ParentProcessId) -and -not $known.ContainsKey([int]$p.ProcessId)){$known[[int]$p.ProcessId]=$true;$changed=$true}}}
  $rows=@(foreach($p in $all){if($known.ContainsKey([int]$p.ProcessId) -or $system -contains $p.Name){[pscustomobject]@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;name=$p.Name;owned=$known.ContainsKey([int]$p.ProcessId);creation=if($p.CreationDate){$p.CreationDate.ToString('o')}else{$null};cpu100ns=([double]$p.KernelModeTime+[double]$p.UserModeTime);workingSet=[double]$p.WorkingSetSize;privateBytes=[double]$p.PrivatePageCount;handles=$p.HandleCount;threads=$p.ThreadCount;readBytes=[double]$p.ReadTransferCount;writeBytes=[double]$p.WriteTransferCount;readOps=[double]$p.ReadOperationCount;writeOps=[double]$p.WriteOperationCount}}})
  $gpuError=$null;$gpu=@();try{$gpu=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop|Where-Object {$_.Name -match '^pid_(\d+)_' -and $known.ContainsKey([int]$Matches[1])}|ForEach-Object{[pscustomobject]@{name=$_.Name;percent=$_.UtilizationPercentage}})}catch{$gpuError=$_.Exception.Message}
  $sample=[pscustomobject]@{timestamp=$start;processes=$rows;gpu=$gpu;gpuError=$gpuError}
  Add-Content -LiteralPath $Output -Value ($sample|ConvertTo-Json -Depth 5 -Compress) -Encoding utf8
 }catch{Add-Content -LiteralPath $Output -Value (([pscustomobject]@{timestamp=$start;error=$_.Exception.Message})|ConvertTo-Json -Compress) -Encoding utf8}
 $remaining=1000-([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()-$start);if($remaining -gt 0){Start-Sleep -Milliseconds $remaining}
}
