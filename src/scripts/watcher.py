"""
Persistent watcher script for CODESYS IPC.

Runs inside CODESYS via --runscript on the primary (UI) thread.
Installs a WinForms timer on the primary (UI) thread that polls a
commands/ directory and executes each command directly on that thread
(no marshalling), then RETURNS. Because no script stays running, CODESYS
keeps its menus and commands enabled while the MCP is connected.

Why no background thread? CODESYS V3.5 SP21+ removed
``system.execute_on_primary_thread()``, the API older versions of this
watcher used to marshal work from a .NET background thread back to the
UI thread. The UI-thread timer here works on SP19, SP21, and SP22+.

{IPC_BASE_DIR} is interpolated by Node.js before launch.
"""
import sys
import os
import time
import traceback
import json
import codecs

# --- Configuration ---
IPC_BASE_DIR = r"{IPC_BASE_DIR}"
COMMANDS_DIR = os.path.join(IPC_BASE_DIR, "commands")
RESULTS_DIR = os.path.join(IPC_BASE_DIR, "results")
POLL_INTERVAL = 50  # milliseconds
WATCHER_VERSION = "0.7.1"

# --- Error capture file (written before anything else can fail) ---
_ERROR_FILE = os.path.join(IPC_BASE_DIR, "watcher_error.txt")

def _write_error(msg):
    try:
        with open(_ERROR_FILE, "a") as f:
            f.write("[%f] %s\n" % (time.time(), msg))
    except:
        pass

try:
    # --- Ensure directories exist ---
    if not os.path.exists(COMMANDS_DIR):
        os.makedirs(COMMANDS_DIR)
    if not os.path.exists(RESULTS_DIR):
        os.makedirs(RESULTS_DIR)

    # --- Text helpers for results (ported from PR #25 by Andrei-Errapart) ---
    def _to_unicode(s):
        try:
            unicode_type = unicode
        except NameError:
            return str(s)  # Python 3; this file targets IronPython 2.7
        if isinstance(s, unicode_type):
            return s
        try:
            return unicode_type(s)
        except (UnicodeDecodeError, TypeError, ValueError):
            try:
                return unicode_type(str(s), 'utf-8', 'replace')
            except (UnicodeDecodeError, TypeError, ValueError):
                return unicode_type(repr(s), 'utf-8', 'replace')

    def _json_safe(obj):
        """Decode the byte strings in a result before json.dumps.

        Under IronPython 'output' (joined by OutputCapture) and 'error'
        (str(e) + traceback) are byte strings, and on a localized IDE not
        ASCII. Try utf-8, mbcs, latin-1 strictly, then a lossy decode that
        cannot fail.
        """
        if isinstance(obj, dict):
            return dict((_json_safe(k), _json_safe(v)) for k, v in obj.items())
        if isinstance(obj, (list, tuple)):
            return [_json_safe(v) for v in obj]
        if obj is None or isinstance(obj, bool):
            return obj
        try:
            unicode_type = unicode
            bytes_type = str
        except NameError:
            unicode_type = str
            bytes_type = bytes
        if isinstance(obj, unicode_type):
            return obj
        if isinstance(obj, bytes_type):
            for codec in ('utf-8', 'mbcs', 'latin-1'):
                try:
                    return obj.decode(codec)
                except (UnicodeDecodeError, LookupError, TypeError, ValueError):
                    continue
            try:
                return obj.decode('latin-1', 'replace')
            except Exception:
                return _to_unicode(repr(obj))
        return obj

    # --- Atomic file write helper ---
    def atomic_write(file_path, content):
        # UTF-8, because _encode_result emits unicode (ensure_ascii=False):
        # a plain text-mode handle would ASCII-encode it and raise, and
        # src/ipc.ts reads results as UTF-8.
        tmp_path = file_path + ".tmp"
        with codecs.open(tmp_path, "w", "utf-8") as f:
            f.write(_to_unicode(content))
            f.flush()
            os.fsync(f.fileno())
        if os.path.exists(file_path):
            os.remove(file_path)
        os.rename(tmp_path, file_path)

    # --- Write ready signal EARLY ---
    ready_path = os.path.join(IPC_BASE_DIR, "ready.signal")
    info = {
        "version": WATCHER_VERSION,
        "python_version": sys.version,
        "platform": sys.platform,
        "ipc_dir": IPC_BASE_DIR,
        "timestamp": time.time(),
        "pid": os.getpid(),
    }
    atomic_write(ready_path, json.dumps(info, indent=2))
    print("[WATCHER] Ready signal written to %s" % ready_path)

    # --- Import scripting engine ---
    _write_error("About to import scriptengine")
    import scriptengine as se
    _write_error("scriptengine imported OK")

    # --- File-based logging ---
    _LOG_FILE = os.path.join(IPC_BASE_DIR, "watcher.log")

    def _log(msg):
        try:
            with open(_LOG_FILE, "a") as f:
                f.write("[%f] %s\n" % (time.time(), msg))
        except:
            pass

    # --- Output Capture ---
    class OutputCapture:
        def __init__(self):
            self._buffer = []
        def write(self, s):
            self._buffer.append(str(s))
        def writelines(self, lines):
            self._buffer.extend([str(l) for l in lines])
        def flush(self):
            pass
        def getvalue(self):
            return ''.join(self._buffer)

    def execute_script(script_code, request_id, exec_fn=None):
        """Execute script_code synchronously on the current (primary) thread.
        Returns the result dict to be written to results/."""
        success = False
        output = ""
        error = ""
        old_stdout = sys.stdout
        old_stderr = sys.stderr
        capture = OutputCapture()
        sys.stdout = capture
        sys.stderr = capture
        try:
            exec_globals = {
                '__builtins__': __builtins__,
                'sys': sys,
                'os': os,
                'time': time,
                'traceback': traceback,
                'shutil': __import__('shutil'),
                # The runner's own sys.stdout is a different object; it
                # redirects to this while it executes the command.
                '__mcp_capture__': capture,
            }
            if exec_fn is not None:
                exec_fn(script_code, exec_globals)
            else:
                exec(script_code, exec_globals)
            output = capture.getvalue()
            if "SCRIPT_ERROR" in output:
                success = False
                error = "Script reported error via SCRIPT_ERROR marker"
            elif "SCRIPT_SUCCESS" in output:
                success = True
            else:
                success = True
        except SystemExit as e:
            output = capture.getvalue()
            exit_code = e.code
            if exit_code is None or exit_code == 0:
                success = True
                if "SCRIPT_ERROR" in output:
                    success = False
                    error = "Script reported error via SCRIPT_ERROR marker"
            elif isinstance(exit_code, int):
                if "SCRIPT_SUCCESS" in output and "SCRIPT_ERROR" not in output:
                    success = True
                else:
                    success = False
                    error = "Script exited with code %s" % exit_code
            elif isinstance(exit_code, str):
                success = False
                error = exit_code
        except KeyboardInterrupt:
            # User pressed "Cancel this operation" in CODESYS during this command.
            # Abort just this command; the watcher keeps running.
            output = capture.getvalue()
            error = "Aborted by user (Cancel pressed in CODESYS)"
            success = False
        except Exception as e:
            output = capture.getvalue()
            error = "%s: %s\n%s" % (type(e).__name__, str(e), traceback.format_exc())
            success = False
        finally:
            sys.stdout = old_stdout
            sys.stderr = old_stderr

        return {
            "requestId": request_id,
            "success": success,
            "output": output,
            "error": error,
            "timestamp": time.time(),
        }

    def _encode_result(result, request_id):
        """Serialize a result; on failure, answer with an ASCII report.

        ensure_ascii=False is the fix: CODESYS's own json library
        (ScriptLib\\4.1.0.0\\json) decodes any str with a character in
        U+0080..U+00FF on its ensure_ascii=True path, and the .NET-backed
        strings of the scripting API pass isinstance(s, str), so one umlaut
        in localized compiler output raised UnicodeDecodeError and the
        result was never written (compile_project timed out on a German
        install although the build succeeded; PR #25 by Andrei-Errapart).
        """
        try:
            return json.dumps(_json_safe(result), ensure_ascii=False)
        except Exception as enc_err:
            _log("Result serialization failed for %s: %s\n%s"
                 % (request_id, enc_err, traceback.format_exc()))
            return json.dumps({
                "requestId": request_id,
                "success": False,
                "output": "",
                "error": "Result could not be serialized; see watcher.log",
                "timestamp": time.time(),
            }, ensure_ascii=True)

    def process_command(command_file, exec_fn=None):
        """Process a single command file end-to-end on the primary thread."""
        command_path = os.path.join(COMMANDS_DIR, command_file)
        request_id = command_file.replace(".command.json", "")
        result_path = os.path.join(RESULTS_DIR, "%s.result.json" % request_id)

        _log("Processing command: %s" % request_id)

        try:
            with open(command_path, "r") as f:
                command_data = json.loads(f.read())
            script_path = command_data.get("scriptPath", "")
            if not os.path.exists(script_path):
                raise IOError("Script file not found: %s" % script_path)
            with open(script_path, "r") as f:
                script_code = f.read()
        except Exception as read_err:
            _log("Error reading command: %s" % read_err)
            # The message embeds the script path, which can be non-ASCII;
            # a raise here must not skip the cleanup either.
            try:
                atomic_write(result_path, _encode_result({
                    "requestId": request_id,
                    "success": False,
                    "output": "",
                    "error": "Read error: %s" % read_err,
                    "timestamp": time.time(),
                }, request_id))
            except Exception as write_err:
                _log("Failed to write read-error result for %s: %s" % (request_id, write_err))
            finally:
                _cleanup_command_files(command_path, request_id)
            return

        result = execute_script(script_code, request_id, exec_fn)
        # The command file MUST go even if the result write fails: the next
        # tick picks the oldest command file again, so a failed write re-ran
        # the same command every 50 ms forever (a download_to_device would
        # repeat its side effect). Failing to answer once is recoverable,
        # failing to stop is not (PR #25 by Andrei-Errapart).
        try:
            atomic_write(result_path, _encode_result(result, request_id))
            _log("Result written for %s: script success=%s" % (request_id, result.get("success")))
        except Exception as write_err:
            _log("Failed to write result for %s: %s" % (request_id, write_err))
        finally:
            _cleanup_command_files(command_path, request_id)

    def _cleanup_command_files(command_path, request_id):
        try:
            if os.path.exists(command_path):
                os.remove(command_path)
            sp = os.path.join(COMMANDS_DIR, "%s.py" % request_id)
            if os.path.exists(sp):
                os.remove(sp)
        except:
            pass

    def _terminate_requested():
        return os.path.exists(os.path.join(IPC_BASE_DIR, "terminate.signal"))

    # --- Timer on the primary thread; the script itself returns ---
    # A --runscript that never ends makes CODESYS grey out its commands for
    # the whole session (it treats the IDE as busy running a script), which
    # also kept the user from reaching Tools > Enable MCP Server on SP22.
    # Instead, a WinForms timer is installed on the UI thread and this script
    # returns. The script engine objects stay usable after the script ends,
    # and each tick runs on the UI thread, so commands still execute on the
    # primary thread without any marshalling (verified on SP21 2026-10-05).
    import clr
    clr.AddReference("System.Windows.Forms")
    import System
    from System.Windows.Forms import Timer

    _state = {"busy": False, "timer": None, "pending": None}

    def _stop_timer():
        t = _state["timer"]
        _state["timer"] = None
        try:
            if t is not None:
                t.Stop()
                t.Dispose()
        finally:
            System.AppDomain.CurrentDomain.SetData(_TIMER_SLOT, None)

    # --- Commands that need a running-script context ---
    # From a timer tick no script is executing, and CODESYS's online layer
    # refuses: create_online_application() raises "Stack empty" (every online
    # tool failed this way since the timer watcher, found 2026-10-05). The
    # IDE's own "Execute Script File" command (CommandHelper.ExecuteScript,
    # synchronous) runs a script with that context. Such commands go through
    # a tiny runner script that calls back into this watcher; the rest keep
    # the fast path (ExecuteScript costs about 0.9 s per call).
    # What counts is which script compiles the command: code exec'd by the
    # watcher (whose own script has returned) has no context even while the
    # runner executes, so the runner hands over its own exec (tested).
    _RUN_SLOT = "codesys-mcp-run:" + IPC_BASE_DIR
    _RUNNER_PATH = os.path.join(IPC_BASE_DIR, "runner.py")
    with open(_RUNNER_PATH, "w") as _rf:
        _rf.write("import System\n"
                  "def _exec_here(code, g):\n"
                  "    import sys\n"
                  "    cap = g.get('__mcp_capture__')\n"
                  "    old = (sys.stdout, sys.stderr)\n"
                  "    if cap is not None:\n"
                  "        sys.stdout = cap\n"
                  "        sys.stderr = cap\n"
                  "    try:\n"
                  "        exec(code, g)\n"
                  "    finally:\n"
                  "        sys.stdout, sys.stderr = old\n"
                  "System.AppDomain.CurrentDomain.GetData(%r)(_exec_here)\n" % _RUN_SLOT)

    def _run_pending(exec_fn):
        process_command(_state["pending"], exec_fn)

    System.AppDomain.CurrentDomain.SetData(_RUN_SLOT, _run_pending)

    _exec_script = {"method": None, "looked": False}

    def _execute_script_method():
        if not _exec_script["looked"]:
            _exec_script["looked"] = True
            try:
                for a in System.AppDomain.CurrentDomain.GetAssemblies():
                    if a.GetName().Name == "ScriptEngine.plugin":
                        t = a.GetType("_3S.CoDeSys.ScriptEngine.CommandHelper")
                        if t is not None:
                            _exec_script["method"] = t.GetMethod("ExecuteScript")
                        break
            except Exception as e:
                _log("CommandHelper.ExecuteScript lookup failed: %s" % e)
        return _exec_script["method"]

    def _needs_script_context(command_file):
        try:
            with open(os.path.join(COMMANDS_DIR, command_file), "r") as f:
                script_path = json.loads(f.read()).get("scriptPath", "")
            with open(script_path, "r") as f:
                code = f.read()
                return "create_online_application(" in code or "create_online_device(" in code
        except Exception:
            return False

    def _dispatch(command_file):
        if _needs_script_context(command_file):
            method = _execute_script_method()
            if method is not None:
                _state["pending"] = command_file
                _log("Running %s through CommandHelper.ExecuteScript" % command_file)
                try:
                    method.Invoke(None, System.Array[System.Object]([_RUNNER_PATH]))
                except Exception as inv_err:
                    _log("CommandHelper.ExecuteScript failed: %s" % inv_err)
                # If the runner never got to it, run it here rather than drop it
                # (or retry it every tick): the command then gets a result.
                if os.path.exists(os.path.join(COMMANDS_DIR, command_file)):
                    _log("Runner did not process %s; running it directly" % command_file)
                    process_command(command_file)
                return
        process_command(command_file)

    # --- Title marker: "... - CODESYS [MCP]" while the MCP can drive it ---
    # There is no script API for menus, so the window title shows it.
    # CODESYS rewrites its title on every project change (verified SP21
    # 2026-10-06), so the tick re-applies it about once a second; a detach
    # (terminate signal) takes it off again.
    TITLE_MARK = " [MCP]"
    _title = {"ticks": 0}

    def _main_form():
        try:
            from System.Windows.Forms import Application
            for f in Application.OpenForms:
                if f.GetType().Name == "MainForm":
                    return f
        except Exception:
            pass
        return None

    def _mark_title(on):
        try:
            f = _main_form()
            if f is None:
                return
            t = f.Text or ""
            if on and not t.endswith(TITLE_MARK):
                f.Text = t + TITLE_MARK
            elif not on and t.endswith(TITLE_MARK):
                f.Text = t[:-len(TITLE_MARK)]
        except Exception as e:
            _log("Title marker failed: %s" % e)

    def _tick(sender, args):
        # A command that opens a dialog or pumps messages (system.delay)
        # lets the timer fire again in the middle of it; never nest.
        if _state["busy"]:
            return
        _state["busy"] = True
        try:
            if _terminate_requested():
                _log("Terminate signal received")
                _mark_title(False)
                _stop_timer()
                return
            _title["ticks"] += 1
            if _title["ticks"] % 20 == 1:
                _mark_title(True)
            cmd_files = sorted([
                f for f in os.listdir(COMMANDS_DIR)
                if f.endswith(".command.json")
            ])
            if cmd_files:
                _dispatch(cmd_files[0])
        except KeyboardInterrupt:
            _log("KeyboardInterrupt during tick - ignored, watcher continues")
        except Exception as e:
            _log("Tick error: %s\n%s" % (e, traceback.format_exc()))
        finally:
            _state["busy"] = False

    # One timer per IPC session. The AppDomain slot keeps the timer (and with
    # it this script's scope) alive after the script returns.
    _TIMER_SLOT = "codesys-mcp-watcher:" + IPC_BASE_DIR
    _old = System.AppDomain.CurrentDomain.GetData(_TIMER_SLOT)
    if _old is not None:
        _old.Stop()
        _old.Dispose()

    _timer = Timer()
    _timer.Interval = POLL_INTERVAL
    _timer.Tick += _tick
    _state["timer"] = _timer
    System.AppDomain.CurrentDomain.SetData(_TIMER_SLOT, _timer)
    _timer.Start()

    print("[WATCHER] Watcher v%s started (UI-thread timer, %d ms); the script now returns" % (WATCHER_VERSION, POLL_INTERVAL))
    print("[WATCHER] IPC directory: %s" % IPC_BASE_DIR)
    _log("Watcher timer started; script returning")

except KeyboardInterrupt:
    # Last-resort: a Cancel that fires before the timer is installed
    # (e.g. during scriptengine import or directory setup) should still
    # exit quietly without the CODESYS exception dialog.
    _write_error("KeyboardInterrupt before the timer was installed - exiting quietly")
    print("[WATCHER] Cancelled by user before the timer was installed; exiting.")
except Exception as _fatal:
    _write_error("FATAL: %s\n%s" % (_fatal, traceback.format_exc()))
    print("[WATCHER] FATAL ERROR: %s" % _fatal)
    traceback.print_exc()
