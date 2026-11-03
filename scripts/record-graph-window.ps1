param([long]$WindowHandle,[string]$Directory,[int]$Rate=60)
$ErrorActionPreference='Stop'
& node (Join-Path $PSScriptRoot 'check-managed-path.mjs') $Directory
if($LASTEXITCODE -ne 0){throw 'Recording path rejected'}
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @('System.Drawing.Common','System.Drawing.Primitives','System.Threading.Thread') @'
using System;using System.IO;using System.Drawing;using System.Drawing.Imaging;using System.Diagnostics;using System.Runtime.InteropServices;using System.Threading;
public class GraphWindowRecorder {
 [StructLayout(LayoutKind.Sequential)]public struct Rect{public int Left,Top,Right,Bottom;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 public static void Run(long handle,string folder,int rate){var hwnd=new IntPtr(handle);Directory.CreateDirectory(folder);SetForegroundWindow(hwnd);var clock=Stopwatch.StartNew();int index=0;Bitmap bitmap=null;Graphics graphics=null;var csv=new StreamWriter(Path.Combine(folder,"frames.csv"));csv.WriteLine("index,epoch,duration");File.WriteAllText(Path.Combine(folder,"ready"),"ready");try{while(!File.Exists(Path.Combine(folder,"stop"))){var started=clock.Elapsed.TotalMilliseconds;var command=Path.Combine(folder,"resize");if(File.Exists(command)){var sizes=File.ReadAllText(command).Split(',');File.Delete(command);int width=int.Parse(sizes[0]),height=int.Parse(sizes[1]);if(width>=1050&&width<=1920&&height>=680&&height<=1100)SetWindowPos(hwnd,IntPtr.Zero,0,0,width,height,0x16);}
 Rect rect;GetWindowRect(hwnd,out rect);int w=rect.Right-rect.Left,h=rect.Bottom-rect.Top;if(bitmap==null||bitmap.Width!=w||bitmap.Height!=h){if(graphics!=null)graphics.Dispose();if(bitmap!=null)bitmap.Dispose();bitmap=new Bitmap(w,h,PixelFormat.Format24bppRgb);graphics=Graphics.FromImage(bitmap);}long epoch=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();graphics.CopyFromScreen(rect.Left,rect.Top,0,0,new Size(w,h),CopyPixelOperation.SourceCopy);bitmap.Save(Path.Combine(folder,"frame-"+index.ToString("D6")+".jpg"),ImageFormat.Jpeg);csv.WriteLine(index+","+epoch+","+(clock.Elapsed.TotalMilliseconds-started).ToString("F3",System.Globalization.CultureInfo.InvariantCulture));csv.Flush();index++;double remaining=(1000.0/rate)-(clock.Elapsed.TotalMilliseconds-started);if(remaining>1)Thread.Sleep((int)remaining);
 }}finally{csv.Dispose();if(graphics!=null)graphics.Dispose();if(bitmap!=null)bitmap.Dispose();}}
}
'@
[GraphWindowRecorder]::Run($WindowHandle,$Directory,$Rate)
