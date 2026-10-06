param([int]$procId, [string]$out)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text; using System.Collections.Generic;
public class WS {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr d, uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
 public struct R { public int L, T, Ri, B; }
 public static List<IntPtr> Top(uint p) { var l = new List<IntPtr>(); EnumWindows((h, x) => { uint q; GetWindowThreadProcessId(h, out q); if (q == p && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero); return l; }
}
"@
$i = 0
foreach ($h in [WS]::Top([uint32]$procId)) {
  $sb = New-Object System.Text.StringBuilder 256; [void][WS]::GetWindowText($h, $sb, 256)
  $r = New-Object WS+R; [void][WS]::GetWindowRect($h, [ref]$r); $w = $r.Ri - $r.L; $ht = $r.B - $r.T
  "window $i : '$($sb.ToString())' ${w}x${ht}"
  if ($w -gt 50 -and $ht -gt 50) {
    $b = New-Object System.Drawing.Bitmap $w, $ht; $g = [System.Drawing.Graphics]::FromImage($b)
    $d = $g.GetHdc(); [void][WS]::PrintWindow($h, $d, 2); $g.ReleaseHdc($d); $b.Save("$out-$i.png")
  }
  $i++
}
