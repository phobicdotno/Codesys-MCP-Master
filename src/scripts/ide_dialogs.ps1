<#
  ide_dialogs.ps1 - list or answer the message boxes a CODESYS process shows.

  A modal box in CODESYS (a network scan result, "No active path defined")
  blocks every script the MCP sends: the online layer then fails with "Stack
  empty" or the call hangs. This helper finds the visible standard dialogs
  (window class #32770) of ONE process and either lists them or presses one
  of their buttons with BM_CLICK sent to the button window. It never uses the
  foreground window, the mouse or the keyboard.

    -TargetPid  CODESYS process id (required)
    -Hwnd       dialog window handle to answer (from a listing)
    -Button     caption of the button to press in that dialog (e.g. OK, Cancel)

  Without -Hwnd: prints ONE JSON line { dialogs: [ { hwnd, title, text, buttons } ] }.
  With -Hwnd and -Button: prints { ok, message } after pressing the button.

  ASCII only: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [long]$Hwnd = 0,
  [string]$Button = ''
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices; using System.Collections.Generic;
public class IdeDlg {
  public delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EP f, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EP f, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  public static string Text(IntPtr h) { var s = new StringBuilder(2048); GetWindowText(h, s, 2048); return s.ToString(); }
  public static string Cls(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static List<IntPtr> Dialogs(int pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { int p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h) && Cls(h) == "#32770") r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static List<IntPtr> Kids(IntPtr w) { var r = new List<IntPtr>(); EnumChildWindows(w, (h, l) => { r.Add(h); return true; }, IntPtr.Zero); return r; }
}
'@

function Describe([IntPtr]$h) {
  $texts = @(); $buttons = @()
  foreach ($k in [IdeDlg]::Kids($h)) {
    $t = [IdeDlg]::Text($k)
    if (-not $t) { continue }
    if ([IdeDlg]::Cls($k) -eq 'Button') { $buttons += ($t -replace '&', '') } else { $texts += $t }
  }
  [ordered]@{ hwnd = $h.ToInt64(); title = [IdeDlg]::Text($h); text = ($texts -join "`n"); buttons = $buttons }
}

try {
  if ($Hwnd -eq 0) {
    $list = @(foreach ($h in [IdeDlg]::Dialogs($TargetPid)) { Describe $h })
    [ordered]@{ dialogs = $list } | ConvertTo-Json -Compress -Depth 4
    exit 0
  }
  $target = $null
  foreach ($h in [IdeDlg]::Dialogs($TargetPid)) { if ($h.ToInt64() -eq $Hwnd) { $target = $h } }
  if ($null -eq $target) { [ordered]@{ ok = $false; message = "dialog $Hwnd is no longer open" } | ConvertTo-Json -Compress; exit 2 }
  foreach ($k in [IdeDlg]::Kids($target)) {
    if ([IdeDlg]::Cls($k) -eq 'Button' -and (([IdeDlg]::Text($k) -replace '&', '') -eq $Button)) {
      [void][IdeDlg]::SendMessage($k, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)  # BM_CLICK
      [ordered]@{ ok = $true; message = "pressed '$Button'" } | ConvertTo-Json -Compress
      exit 0
    }
  }
  [ordered]@{ ok = $false; message = "no button '$Button' in dialog $Hwnd" } | ConvertTo-Json -Compress
  exit 2
} catch {
  [ordered]@{ ok = $false; message = $_.Exception.Message; dialogs = @() } | ConvertTo-Json -Compress
  exit 2
}
