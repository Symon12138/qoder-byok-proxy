Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class QZ2 {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(240);
    mouse_event(0x02, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(90);
    mouse_event(0x04, 0, 0, 0, IntPtr.Zero);
  }
  public static bool Force(IntPtr h) {
    uint pid;
    uint ft = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    AttachThreadInput(GetCurrentThreadId(), ft, true);
    ShowWindow(h, 9);
    BringWindowToTop(h);
    bool r = SetForegroundWindow(h);
    AttachThreadInput(GetCurrentThreadId(), ft, false);
    return r;
  }
  public static IntPtr MainWin() {
    IntPtr f = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var sb = new StringBuilder(512);
      GetWindowText(h, sb, 512);
      if (sb.ToString().EndsWith("- Qoder IDE", StringComparison.OrdinalIgnoreCase)) { f = h; return false; }
      return true;
    }, IntPtr.Zero);
    return f;
  }
  public static string Title(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, 512);
    return sb.ToString();
  }
}
"@ -ErrorAction SilentlyContinue

$h = [QZ2]::MainWin()
[void][QZ2]::Force($h)
Start-Sleep -Seconds 2
$fg = [QZ2]::GetForegroundWindow()
$ok = ($fg -eq $h)
Write-Output ("qoder hwnd   : " + $h)
Write-Output ("foreground   : " + [QZ2]::Title($fg))
Write-Output ("qoder on top : " + $ok)

if ($ok) {
  [QZ2]::Click(1600, 945)
  Start-Sleep -Milliseconds 800
  Set-Clipboard -Value 'final-e2e-probe-T9M2'
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Seconds 2
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  Write-Output "sent, waiting 20s"
  Start-Sleep -Seconds 20
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
  $out = Join-Path $PSScriptRoot '_rt_out\final_e2e2.png'
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output ("screenshot: " + $out)
} else {
  Write-Output "abort: qoder is not foreground"
}
