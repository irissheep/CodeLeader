param([Parameter(Mandatory=$true)][long]$WindowHandle,[Parameter(Mandatory=$true)][string]$Output,[int]$Frames=1,[int]$Width=0,[int]$Height=0)
$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'check-managed-path.mjs') $Output
if($LASTEXITCODE -ne 0){throw 'Screenshot path rejected'}
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class RuntimeWindowCapture {
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h,int command);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h,IntPtr dc,uint flags);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
}
'@
$handle=[IntPtr]$WindowHandle
if([RuntimeWindowCapture]::IsIconic($handle)){[RuntimeWindowCapture]::ShowWindowAsync($handle,9)|Out-Null;Start-Sleep -Milliseconds 400}
if($Width -ge 1050 -and $Height -ge 680 -and $Width -le 3840 -and $Height -le 2160){[RuntimeWindowCapture]::SetWindowPos($handle,[IntPtr]::Zero,0,0,$Width,$Height,0x16)|Out-Null;Start-Sleep -Milliseconds 400}
[RuntimeWindowCapture]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 120
$rect=New-Object RuntimeWindowCapture+Rect
[RuntimeWindowCapture]::GetWindowRect($handle,[ref]$rect) | Out-Null
$bitmap=New-Object Drawing.Bitmap ($rect.Right-$rect.Left),($rect.Bottom-$rect.Top)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
try {
  for($frame=0;$frame -lt $Frames;$frame++){
    $dc=$graphics.GetHdc()
    try {[RuntimeWindowCapture]::PrintWindow($handle,$dc,2) | Out-Null} finally {$graphics.ReleaseHdc($dc)}
    if($Frames -eq 1){$destination=$Output;$format=[Drawing.Imaging.ImageFormat]::Png}else{$destination=Join-Path $Output ('frame-{0:d4}.jpg' -f $frame);$format=[Drawing.Imaging.ImageFormat]::Jpeg}
    $bitmap.Save($destination,$format)
    if($Frames -gt 1){Start-Sleep -Milliseconds 500}
  }
} finally {$graphics.Dispose();$bitmap.Dispose()}
