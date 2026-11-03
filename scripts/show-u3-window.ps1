$ErrorActionPreference = 'Stop'
$u3Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($env:TEMP -ne (Join-Path $u3Root '.tmp')) { throw 'Use the D drive project entry.' }
$u3Folder = Join-Path $u3Root '.tmp\verification-u3-adaptive-look'
$u3Info = Get-Content -LiteralPath (Join-Path $u3Folder 'latest-development.json') -Raw | ConvertFrom-Json
$u3Process = Get-Process -Id ([int]$u3Info.pid)
if ($u3Process.ProcessName -ne 'electron' -or $u3Process.MainWindowTitle -ne 'CodeLeader' -or -not $u3Process.Path.StartsWith((Join-Path $u3Root 'node_modules\electron\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'This is not the owned development window.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class U3Window {
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int command);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
}
'@
$u3Restored = [U3Window]::ShowWindowAsync($u3Process.MainWindowHandle, 9)
$u3Foreground = [U3Window]::SetForegroundWindow($u3Process.MainWindowHandle)
@{ pid=$u3Process.Id; restored=$u3Restored; foreground=$u3Foreground; minimized=[U3Window]::IsIconic($u3Process.MainWindowHandle); visible=[U3Window]::IsWindowVisible($u3Process.MainWindowHandle) } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $u3Folder 'window-visibility.json') -Encoding utf8
