<#
  attach_uia.ps1 - run the MCP attach script in a running CODESYS without the user.

  Presses Tools > Scripting > Execute Script File... of ONE CODESYS, chosen by
  process id, through the accessibility interface of its WinForms menu
  (MSAA IAccessible, the provider Windows UI Automation wraps for WinForms),
  and fills the Open dialog with window messages. Never uses the foreground
  window, never moves the mouse, never sends keystrokes to the desktop.

  Why MSAA and not the managed UI Automation client: on CODESYS SP18 the
  System.Windows.Automation tree shows the menu strip as an empty Pane (no
  MenuItem children), while IAccessible lists the whole menu, submenus
  included, without opening it. "Press" (accDoDefaultAction) on the hidden
  Execute Script File item runs the command directly, so no menu opens on
  screen; opening Tools and Scripting first is only the fallback.

    -TargetPid       CODESYS process id (required)
    -ScriptPath      the attach script to run (required unless -ProbeOnly)
    -TimeoutSeconds  how long to wait for the [MCP] title marker (default 60)
    -ProbeOnly       find the menu path, run nothing

  Prints ONE JSON line: { ok, stage, message, title, matchedBy, menu }.
  Exit code 0 on success, 2 on failure.

  Stages: platform, process, window, already, modal, menu-bar, menu-tools,
  menu-scripting, menu-execute, file-dialog, file-name, open, script, verify,
  done, probe.

  ASCII only: Windows PowerShell 5.1 reads a .ps1 without BOM as ANSI.
#>
param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [string]$ScriptPath = '',
  [int]$TimeoutSeconds = 60,
  [switch]$ProbeOnly
)

$ErrorActionPreference = 'Stop'

function Out-Json($r) {
  $o = [ordered]@{
    ok        = [bool]$r.Ok
    stage     = [string]$r.Stage
    message   = [string]$r.Message
    title     = [string]$r.Title
    matchedBy = @($r.MatchedBy)
    menu      = @($r.Menu)
  }
  [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4))
  if ($r.Ok) { exit 0 } else { exit 2 }
}

$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Accessibility;

public class McpAttachResult {
  public bool Ok;
  public string Stage = "";
  public string Message = "";
  public string Title = "";
  public List<string> MatchedBy = new List<string>();
  public List<string> Menu = new List<string>();
}

public static class McpAttach {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetDlgItem(IntPtr h, int id);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")]
  static extern IntPtr SendText(IntPtr h, uint msg, IntPtr w, string l, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "SendMessageTimeoutW")]
  static extern IntPtr SendBuf(IntPtr h, uint msg, IntPtr w, StringBuilder l, uint flags, uint timeout, out IntPtr result);
  [DllImport("oleacc.dll")] static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object o);
  [DllImport("oleacc.dll")] static extern int AccessibleChildren(IAccessible a, int start, int count, [Out] object[] children, out int obtained);

  const int ROLE_MENUBAR = 2, ROLE_MENUITEM = 12;
  const int STATE_UNAVAILABLE = 0x1;
  const int FILE_NAME_ID = 1148, IDOK = 1;
  public static int StartupWaitMs = 90000;
  const uint WM_SETTEXT = 0x000C, WM_GETTEXT = 0x000D, WM_COMMAND = 0x0111, SMTO_ABORTIFHUNG = 0x0002;

  // ---- windows ----
  static List<IntPtr> TopWindows(uint pid) {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid && IsWindowVisible(h)) list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  static List<IntPtr> Descendants(IntPtr parent) {
    var list = new List<IntPtr>();
    EnumChildWindows(parent, (h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  static string Text(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, sb.Capacity); return sb.ToString(); }
  static string Class(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, sb.Capacity); return sb.ToString(); }
  static bool SetText(IntPtr h, string t) { IntPtr r; return SendText(h, WM_SETTEXT, IntPtr.Zero, t, SMTO_ABORTIFHUNG, 5000, out r) != IntPtr.Zero; }
  static string GetText(IntPtr h) { var sb = new StringBuilder(4096); IntPtr r; SendBuf(h, WM_GETTEXT, (IntPtr)sb.Capacity, sb, SMTO_ABORTIFHUNG, 5000, out r); return sb.ToString(); }

  // The main window is the CODESYS-titled window that holds the menu bar.
  // While CODESYS starts, a splash window titled "CODESYS" (no menu) is the
  // only one: then bar stays zero and the caller waits.
  static IntPtr MainWindow(Process p, out IntPtr bar) {
    bar = IntPtr.Zero;
    IntPtr first = IntPtr.Zero;
    foreach (var h in TopWindows((uint)p.Id)) {
      if (Class(h) == "#32770" || Text(h).IndexOf("CODESYS", StringComparison.OrdinalIgnoreCase) < 0) continue;
      if (first == IntPtr.Zero) first = h;
      var b = FindMenuBar(h);
      if (b != IntPtr.Zero) { bar = b; return h; }
    }
    if (first != IntPtr.Zero) return first;
    p.Refresh();
    return p.MainWindowHandle;
  }
  static IntPtr MainWindow(Process p) { IntPtr bar; return MainWindow(p, out bar); }

  static string OtherWindows(uint pid, IntPtr main, bool withText) {
    var parts = new List<string>();
    foreach (var h in TopWindows(pid)) {
      if (h == main || !IsWindowEnabled(h)) continue;
      string s = "'" + Text(h) + "'";
      if (withText) {
        var texts = new List<string>();
        foreach (var c in Descendants(h)) if (Class(c) == "Static") { var t = Text(c); if (t.Length > 0) texts.Add(t); }
        if (texts.Count > 0) s += ": " + string.Join(" ", texts.ToArray());
      }
      parts.Add(s);
    }
    return parts.Count > 0 ? string.Join("; ", parts.ToArray()) : "(no title)";
  }

  // ---- accessibility ----
  static IAccessible FromWindow(IntPtr h) {
    Guid g = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object o;
    if (AccessibleObjectFromWindow(h, 0xFFFFFFFC, ref g, out o) != 0) return null;
    return o as IAccessible;
  }
  static List<IAccessible> Kids(IAccessible a) {
    var res = new List<IAccessible>();
    int n = 0;
    try { n = a.accChildCount; } catch { return res; }
    if (n <= 0) return res;
    var k = new object[n]; int got;
    if (AccessibleChildren(a, 0, n, k, out got) != 0) return res;
    for (int i = 0; i < got; i++) { var ka = k[i] as IAccessible; if (ka != null) res.Add(ka); }
    return res;
  }
  static string Name(IAccessible a) { try { return a.get_accName(0) ?? ""; } catch { return ""; } }
  static int Role(IAccessible a) { try { return Convert.ToInt32(a.get_accRole(0)); } catch { return -1; } }
  static int State(IAccessible a) { try { return Convert.ToInt32(a.get_accState(0)); } catch { return 0; } }
  static string Norm(string s) {
    return Regex.Replace((s ?? "").Replace("&", ""), @"(\.\.\.|\u2026)\s*$", "").Trim().ToLowerInvariant();
  }

  static int FindIndex(List<IAccessible> items, string[] names) {
    for (int i = 0; i < items.Count; i++) { var n = Norm(Name(items[i])); foreach (var w in names) if (n == w) return i; }
    return -1;
  }
  static int FindPattern(List<IAccessible> items, string regex) {
    for (int i = 0; i < items.Count; i++) if (Regex.IsMatch(Norm(Name(items[i])), regex)) return i;
    return -1;
  }

  // The menu bar: a child window whose IAccessible is a menu bar of menu items.
  static IntPtr FindMenuBar(IntPtr main) {
    foreach (var h in Descendants(main)) {
      if (GetParent(h) != main) continue;
      var a = FromWindow(h);
      if (a == null || Role(a) != ROLE_MENUBAR) continue;
      int items = 0;
      foreach (var k in Kids(a)) if (Role(k) == ROLE_MENUITEM) items++;
      if (items >= 3) return h;
    }
    return IntPtr.Zero;
  }

  static readonly string[] ToolsNames = { "tools", "extras", "outils", "herramientas", "strumenti", "ferramentas", "narzedzia", "verktyg" };
  static readonly string[] ScriptingNames = { "scripting", "skripting", "skripte", "scripts", "script", "scripte" };

  static IAccessible Resolve(IntPtr bar, int[] path) {
    IAccessible a = FromWindow(bar);
    foreach (int i in path) { var k = Kids(a); if (i >= k.Count) return null; a = k[i]; }
    return a;
  }

  // "Press" may not return while the modal Open dialog is up: own thread.
  static Thread Press(IntPtr bar, int[] path, Action<Exception> onError) {
    var t = new Thread(() => {
      try {
        var a = Resolve(bar, path);
        if (a == null) throw new Exception("menu item vanished");
        a.accDoDefaultAction(0);
      } catch (Exception e) { onError(e); }
    });
    t.IsBackground = true;
    t.SetApartmentState(ApartmentState.STA);
    t.Start();
    return t;
  }

  static IntPtr FindFileNameEdit(IntPtr dlg) {
    foreach (var c in Descendants(dlg)) {
      if (GetDlgCtrlID(c) != FILE_NAME_ID) continue;
      if (Class(c) == "Edit") return c;
      foreach (var e in Descendants(c)) if (Class(e) == "Edit") return e;
    }
    return IntPtr.Zero;
  }
  static IntPtr FindOpenDialog(uint pid, out IntPtr edit) {
    edit = IntPtr.Zero;
    foreach (var h in TopWindows(pid)) {
      if (Class(h) != "#32770") continue;
      var e = FindFileNameEdit(h);
      if (e != IntPtr.Zero) { edit = e; return h; }
    }
    return IntPtr.Zero;
  }

  static McpAttachResult Fail(McpAttachResult r, string stage, string msg) { r.Ok = false; r.Stage = stage; r.Message = msg; return r; }
  static McpAttachResult Done(McpAttachResult r, string stage, string msg) { r.Ok = true; r.Stage = stage; r.Message = msg; return r; }

  public static McpAttachResult Run(int pid, string scriptPath, int timeoutSec, bool probe) {
    var r = new McpAttachResult();
    Process p;
    try { p = Process.GetProcessById(pid); } catch { return Fail(r, "process", "No process with PID " + pid + "."); }
    if (!string.Equals(p.ProcessName, "CODESYS", StringComparison.OrdinalIgnoreCase))
      return Fail(r, "process", "PID " + pid + " is '" + p.ProcessName + "', not CODESYS.");
    uint upid = (uint)pid;

    // A CODESYS still starting shows only its splash window: wait for the
    // main window with its menu bar (verified on SP18: the splash is titled
    // "CODESYS" and has no menu).
    IntPtr main = IntPtr.Zero, bar = IntPtr.Zero;
    var boot = Stopwatch.StartNew();
    for (;;) {
      if (p.HasExited) return Fail(r, "process", "CODESYS PID " + pid + " exited.");
      main = MainWindow(p, out bar);
      if (main != IntPtr.Zero) {
        r.Title = Text(main);
        if (r.Title.EndsWith(" [MCP]")) return Done(r, "already", "CODESYS PID " + pid + " already runs an MCP watcher (title '" + r.Title + "').");
        if (bar != IntPtr.Zero && !IsWindowEnabled(main))
          return Fail(r, "modal", "CODESYS PID " + pid + " shows a modal dialog (" + OtherWindows(upid, main, false) + "). Close it in CODESYS first, then retry.");
        if (bar != IntPtr.Zero) break;
      }
      if (boot.ElapsedMilliseconds > StartupWaitMs) {
        if (main == IntPtr.Zero) return Fail(r, "window", "CODESYS PID " + pid + " has no visible main window after " + (StartupWaitMs / 1000) + " s.");
        string extra = "";
        foreach (var h in TopWindows(upid)) if (h != main) extra += " '" + Text(h) + "'";
        return Fail(r, "menu-bar", "No menu bar in the CODESYS window of PID " + pid + " after " + (StartupWaitMs / 1000) + " s (still starting, or a dialog is up). Windows: '" + Text(main) + "'" + extra + ".");
      }
      Thread.Sleep(1000);
    }
    var top = Kids(FromWindow(bar));
    foreach (var t in top) r.Menu.Add(Name(t));

    // Tools: by name (English and the usual CODESYS UI languages), else the
    // top menu that holds a Scripting entry.
    int iTools = FindIndex(top, ToolsNames);
    if (iTools >= 0) r.MatchedBy.Add("tools:name");
    else {
      for (int i = 0; i < top.Count && iTools < 0; i++)
        if (FindIndex(Kids(top[i]), ScriptingNames) >= 0 || FindPattern(Kids(top[i]), "skript|script") >= 0) iTools = i;
      if (iTools >= 0) r.MatchedBy.Add("tools:holds-scripting");
    }
    if (iTools < 0) {
      // Last resort: the CODESYS menu bar ends with Tools, Window, Help
      // (an MDI entry with a numeric name may follow).
      var named = new List<int>();
      for (int i = 0; i < top.Count; i++) if (!Regex.IsMatch(Name(top[i]).Trim(), @"^\d*$")) named.Add(i);
      if (named.Count >= 4) { iTools = named[named.Count - 3]; r.MatchedBy.Add("tools:position"); }
    }
    if (iTools < 0) return Fail(r, "menu-tools", "No Tools menu in the menu bar: " + string.Join(" | ", r.Menu.ToArray()));
    var toolsItems = Kids(top[iTools]);

    // Scripting: by name, by pattern, else the last Tools entry with a submenu
    // whose first item opens a dialog ("...").
    int iScr = FindIndex(toolsItems, ScriptingNames);
    if (iScr >= 0) r.MatchedBy.Add("scripting:name");
    else {
      iScr = FindPattern(toolsItems, "skript|script");
      if (iScr >= 0) r.MatchedBy.Add("scripting:pattern");
      else {
        for (int i = toolsItems.Count - 1; i >= 0 && iScr < 0; i--) {
          var k = Kids(toolsItems[i]);
          if (k.Count > 0 && Regex.IsMatch(Name(k[0]), @"(\.\.\.|\u2026)\s*$")) iScr = i;
        }
        if (iScr >= 0) r.MatchedBy.Add("scripting:position");
      }
    }
    var toolsNames = new List<string>(); foreach (var t in toolsItems) toolsNames.Add(Name(t));
    if (iScr < 0) return Fail(r, "menu-scripting", "No Scripting entry under '" + Name(top[iTools]) + "': " + string.Join(" | ", toolsNames.ToArray()));
    var scrItems = Kids(toolsItems[iScr]);

    int iExec = FindPattern(scrItems, "^execute script file$");
    if (iExec >= 0) r.MatchedBy.Add("execute:name");
    else {
      iExec = FindPattern(scrItems, @"(execute|run|ausf|ejecutar|ex.cuter|esegui).*(script|skript)|(script|skript).*(datei|file|fichier|archivo)");
      if (iExec >= 0) r.MatchedBy.Add("execute:pattern");
      else if (scrItems.Count > 0) { iExec = 0; r.MatchedBy.Add("execute:position"); }
    }
    if (iExec < 0) return Fail(r, "menu-execute", "No Execute Script File entry under '" + Name(toolsItems[iScr]) + "'.");
    var exec = scrItems[iExec];
    string pathText = Name(top[iTools]) + " > " + Name(toolsItems[iScr]) + " > " + Name(exec);
    if ((State(exec) & STATE_UNAVAILABLE) != 0)
      return Fail(r, "menu-execute", pathText + " is disabled in CODESYS PID " + pid + " (busy?). Retry when it is idle.");
    if (probe) return Done(r, "probe", "Found " + pathText + " (probe only, nothing run).");

    if (string.IsNullOrEmpty(scriptPath) || !System.IO.File.Exists(scriptPath))
      return Fail(r, "file-name", "Attach script not found: '" + scriptPath + "'.");

    var before = new HashSet<IntPtr>(TopWindows(upid));
    Exception pressError = null;
    int[] execPath = { iTools, iScr, iExec };
    Thread presser = Press(bar, execPath, e => pressError = e);

    IntPtr edit;
    IntPtr dlg = IntPtr.Zero;
    bool expanded = false;
    var sw = Stopwatch.StartNew();
    while (sw.ElapsedMilliseconds < 25000) {
      dlg = FindOpenDialog(upid, out edit);
      if (dlg != IntPtr.Zero) break;
      if (pressError != null) return Fail(r, "menu-execute", "Pressing " + pathText + " failed: " + pressError.Message);
      // Fallback: the hidden item did nothing within 6 s; open Tools and
      // Scripting the way a click would, then press again.
      if (!expanded && sw.ElapsedMilliseconds > 6000 && !presser.IsAlive) {
        expanded = true;
        r.MatchedBy.Add("press:expanded");
        try {
          Resolve(bar, new[] { iTools }).accDoDefaultAction(0);
          Thread.Sleep(400);
          Resolve(bar, new[] { iTools, iScr }).accDoDefaultAction(0);
          Thread.Sleep(400);
        } catch (Exception e) { return Fail(r, "menu-scripting", "Opening " + pathText + " failed: " + e.Message); }
        presser = Press(bar, execPath, e => pressError = e);
      }
      Thread.Sleep(200);
    }
    if (dlg == IntPtr.Zero) {
      var fresh = new List<string>();
      foreach (var h in TopWindows(upid)) if (!before.Contains(h)) fresh.Add("'" + Text(h) + "'");
      return Fail(r, "file-dialog", "The Open dialog did not appear after " + pathText + ". New windows: " + (fresh.Count > 0 ? string.Join(", ", fresh.ToArray()) : "none"));
    }
    if (!expanded) r.MatchedBy.Add("press:direct");
    FindOpenDialog(upid, out edit);

    SetText(edit, scriptPath);
    if (GetText(edit) != scriptPath)
      return Fail(r, "file-name", "Could not put the script path into the Open dialog's file name box; the dialog is still open in CODESYS PID " + pid + ", cancel it there.");

    // Open: WM_COMMAND(IDOK, BN_CLICKED) to the dialog, posted (no focus needed, no wait).
    PostMessage(dlg, WM_COMMAND, (IntPtr)IDOK, GetDlgItem(dlg, IDOK));
    sw.Restart();
    while (IsWindow(dlg) && IsWindowVisible(dlg) && sw.ElapsedMilliseconds < 10000) Thread.Sleep(200);
    if (IsWindow(dlg) && IsWindowVisible(dlg))
      return Fail(r, "open", "The Open dialog did not close after Open; it is still open in CODESYS PID " + pid + ".");

    sw.Restart();
    long limit = Math.Max(5, timeoutSec) * 1000L;
    while (sw.ElapsedMilliseconds < limit) {
      if (!IsWindow(main)) main = MainWindow(p);
      if (main != IntPtr.Zero) {
        r.Title = Text(main);
        if (r.Title.EndsWith(" [MCP]")) return Done(r, "done", "Ran the attach script in CODESYS PID " + pid + " (" + pathText + "); title '" + r.Title + "'.");
        if (!IsWindowEnabled(main) && FindOpenDialog(upid, out edit) == IntPtr.Zero && sw.ElapsedMilliseconds > 1500)
          return Fail(r, "script", "CODESYS PID " + pid + " shows a dialog after the script ran: " + OtherWindows(upid, main, true));
      }
      Thread.Sleep(300);
    }
    return Fail(r, "verify", "The script ran but CODESYS PID " + pid + " shows no [MCP] title marker within " + (limit / 1000) + " s (title '" + r.Title + "').");
  }
}
'@

try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies Accessibility -Language CSharp
} catch {
  Out-Json @{ Ok = $false; Stage = 'platform'; Message = ('Could not load the accessibility helper: ' + $_.Exception.Message); Title = ''; MatchedBy = @(); Menu = @() }
}

try {
  $r = [McpAttach]::Run($TargetPid, $ScriptPath, $TimeoutSeconds, [bool]$ProbeOnly)
} catch {
  Out-Json @{ Ok = $false; Stage = 'platform'; Message = ('Attach automation crashed: ' + $_.Exception.Message); Title = ''; MatchedBy = @(); Menu = @() }
}
Out-Json $r
