import traceback

# --- Function to ensure an online connection to the active application ---
def ensure_online_connection(primary_project):
    """Get or create an online application connection for the active application."""
    print("DEBUG: Ensuring online connection...")
    # Device credentials (tool args, else CODESYS_DEVICE_USER/PASSWORD on the
    # MCP server): registered before any login, so a PLC with user management
    # never pops the Device User Logon dialog (it hung read/write/reset/stop/
    # disconnect once a device user existed, 2026-10-05).
    if 'register_device_credentials_if_set' in globals():
        register_device_credentials_if_set()
    if 'apply_application_selection' in globals():
        apply_application_selection(primary_project)

    target_app = None
    app_name = "N/A"

    # Try getting active application
    try:
        target_app = primary_project.active_application
        if target_app:
            app_name = getattr(target_app, 'get_name', lambda: "Unnamed App")()
    except Exception as e:
        print("WARN: Could not get active application: %s" % e)

    # Search for first application if no active
    if not target_app:
        try:
            all_children = primary_project.get_children(True)
            for child in all_children:
                if hasattr(child, 'is_application') and child.is_application:
                    target_app = child
                    app_name = getattr(child, 'get_name', lambda: "Unnamed App")()
                    break
        except Exception as e:
            print("WARN: Error finding application: %s" % e)

    if not target_app:
        raise RuntimeError("No application found in project.")

    print("DEBUG: Using application: %s" % app_name)

    # Try to get or create online application
    online_app = None

    # Pattern 1: app.create_online_application()
    if hasattr(target_app, 'create_online_application'):
        try:
            online_app = target_app.create_online_application()
            if online_app:
                print("DEBUG: Created online application via app.create_online_application()")
                return online_app, target_app
        except Exception as e:
            print("DEBUG: app.create_online_application() failed: %s" % e)

    # Pattern 2: scriptengine online module
    try:
        import scriptengine as se
        if hasattr(se, 'online'):
            online_module = se.online
            if hasattr(online_module, 'create_online_application'):
                try:
                    online_app = online_module.create_online_application(target_app)
                    if online_app:
                        print("DEBUG: Created online application via scriptengine.online.create_online_application()")
                        return online_app, target_app
                except Exception as e:
                    print("DEBUG: scriptengine.online.create_online_application() failed: %s" % e)
    except Exception as e:
        print("DEBUG: scriptengine online module access failed: %s" % e)

    # Pattern 3: Check if there's already an online_application property
    if hasattr(target_app, 'online_application'):
        try:
            online_app = target_app.online_application
            if online_app:
                print("DEBUG: Found existing online application via app.online_application")
                return online_app, target_app
        except Exception as e:
            print("DEBUG: app.online_application failed: %s" % e)

    if not online_app:
        raise RuntimeError("Could not create online application connection. Ensure a device/gateway is configured in the project.")

    # Open the shared device session before returning. The IDE's
    # "right-click device -> Connect" maps to ScriptOnlineDevice.connect()
    # on a ScriptOnlineDevice created from the project's device object.
    # Without this, login() may pop dialogs the agent can't see or hang
    # while it waits for a session that nobody opened.
    _ensure_device_connected(primary_project, target_app)

    return online_app, target_app


def _ensure_device_connected(primary_project, target_app=None):
    """Locate the project's PLC device and open a shared online session
    on it if one isn't already open. Idempotent. Best-effort: any failure
    is logged but does NOT abort -- login() will surface its own error
    if the session truly couldn't be opened."""
    try:
        import scriptengine as _se
        online = getattr(_se, 'online', None)
        if online is None or not hasattr(online, 'create_online_device'):
            print("DEBUG: ensure_device_connected: scriptengine.online.create_online_device unavailable -- skipping")
            return

        # Inline device-pick (helper find_target_device may not be in scope
        # here -- ensure_online_connection.py is concatenated into scripts
        # that don't always import it). Keep selection criteria identical.
        target_device = None
        routed = []
        try:
            for c in primary_project.get_children(True):
                try:
                    if not getattr(c, 'is_device', False):
                        continue
                    gw = c.get_gateway()
                    addr = c.get_address()
                except Exception:
                    continue
                if gw is None:
                    continue
                gw_str = str(gw)
                if not gw_str or gw_str == '00000000-0000-0000-0000-000000000000':
                    continue
                if not addr or not str(addr).strip():
                    continue
                routed.append(c)
        except Exception as e:
            print("DEBUG: ensure_device_connected: device walk failed: %s" % e)
            return
        # Multi-device projects: prefer the routed device that hosts the
        # target application. Single-device projects keep the historical
        # 'first routed device' behaviour.
        if len(routed) > 1 and target_app is not None:
            try:
                node = target_app
                guard = 0
                while node is not None and guard < 32 and not hasattr(node, 'active_application'):
                    guard += 1
                    if getattr(node, 'is_device', False):
                        for d in routed:
                            try:
                                if str(d.guid) == str(node.guid):
                                    target_device = d
                            except Exception:
                                pass
                        break
                    node = node.parent
            except Exception as e:
                print("DEBUG: ensure_device_connected: app->device walk failed: %s" % e)
            if target_device is not None:
                print("DEBUG: ensure_device_connected: %d routed devices; using the one hosting the target application" % len(routed))
        if target_device is None and routed:
            target_device = routed[0]

        if target_device is None:
            print("DEBUG: ensure_device_connected: no PLC device with route -- skipping")
            return

        try:
            online_device = online.create_online_device(target_device)
        except Exception as e:
            print("DEBUG: ensure_device_connected: create_online_device failed: %s" % e)
            return

        # Already connected? Nothing to do.
        try:
            if getattr(online_device, 'connected', False) or getattr(online_device, 'shared_connected', False):
                print("DEBUG: ensure_device_connected: device session already open -- skipping connect()")
                return
        except Exception:
            pass

        try:
            online_device.connect()
            print("DEBUG: ensure_device_connected: online_device.connect() succeeded")
        except Exception as e:
            # Don't abort -- login() runs next and has its own retry
            # machinery for session-open errors. Just log so the failure
            # is visible in the script output.
            print("DEBUG: ensure_device_connected: online_device.connect() failed: %s: %s -- letting login() retry" % (type(e).__name__, e))
    except Exception as e:
        print("DEBUG: ensure_device_connected: unexpected error: %s: %s -- skipping" % (type(e).__name__, e))
# --- End of ensure_online_connection function ---


# --- Function to ensure the online application is logged in ---
# Login modes that never change the program on the PLC. CODESYS OnlineChangeOption
# (SP21: Force, Keep, Never, Try): Try = online change if possible, else a FULL
# DOWNLOAD; Never = full download; Force = forced online change; Keep = "login
# without any change", the PLC keeps its program. Every tool that only looks
# at the PLC or starts/stops it must log in with Keep. Changing the program is
# download_to_device's job, which has its own login. (2026-11: a connect with a
# project that differed from the running application logged in with Try, ran a
# full download, and left the application in STOP without a boot application.)
NO_DOWNLOAD_LOGIN_MODES = ('Keep',)


def login_without_download(online_app, log_prefix="login"):
    """Log in with OnlineChangeOption.Keep only. Refuses when this CODESYS has
    no Keep mode instead of falling back to a mode that can download. A real
    login failure (refused, no connection) is raised as it comes."""
    import scriptengine as _se_l
    sources = []
    for holder in (_se_l, online_app):
        for src_name in ('OnlineChangeOption', 'LoginMode'):
            if hasattr(holder, src_name):
                try:
                    sources.append(getattr(holder, src_name))
                except Exception:
                    pass
    keep = None
    for oc in sources:
        for nm in NO_DOWNLOAD_LOGIN_MODES:
            if hasattr(oc, nm):
                try:
                    keep = getattr(oc, nm)
                except Exception:
                    keep = None
            if keep is not None:
                break
        if keep is not None:
            break
    if keep is None:
        raise RuntimeError(
            "%s: this CODESYS offers no 'Keep' login mode. Refusing to log in: every other "
            "mode can download the project to the PLC. Use download_to_device to change the PLC." % log_prefix)
    last_err = None
    # (Keep, False): SP21+ login(OnlineChangeOption, bool); the bool stays False
    # (True would delete other applications on the device). (Keep,): older SPs.
    for desc, args in (("login(Keep, False)", (keep, False)), ("login(Keep)", (keep,))):
        try:
            online_app.login(*args)
            print("DEBUG: %s: %s succeeded (no download, the PLC keeps its program)" % (log_prefix, desc))
            return
        except TypeError as e:
            # this call shape does not fit this SP's login(): try the next one
            last_err = e
    raise RuntimeError("%s: login() takes neither (Keep, False) nor (Keep): %s" % (log_prefix, last_err))


def warn_if_plc_runs_other_version(online_app, target_app, log_prefix="connect"):
    """After a Keep login: compare _MCP_PROJECT_VERSION.sVersion on the PLC with
    the project's. Returns a warning text when they differ, else ''. Silent
    when the project has no version GVL or the value cannot be read."""
    import re as _re
    ide_version = None
    try:
        for obj in target_app.get_children(True):
            try:
                if obj.get_name() != '_MCP_PROJECT_VERSION' or not hasattr(obj, 'textual_declaration'):
                    continue
                m = _re.search(r"sVersion\s*:\s*STRING[^:]*:=\s*'([^']*)'", obj.textual_declaration.text)
                if m:
                    ide_version = m.group(1)
                    break
            except Exception:
                continue
    except Exception:
        return ''
    if not ide_version:
        return ''
    try:
        plc_version = str(online_app.read_value('_MCP_PROJECT_VERSION.sVersion')).strip().strip("'")
    except Exception as e:
        print("DEBUG: %s: could not read _MCP_PROJECT_VERSION.sVersion on the PLC: %s" % (log_prefix, e))
        return ''
    if plc_version == ide_version:
        return ''
    return ("WARNING: the PLC runs version %s, this project is %s. Logged in WITHOUT download (Keep): "
            "the PLC keeps its program, and variables that differ between the two may not read. "
            "Use download_to_device to change the PLC." % (plc_version, ide_version))


def ensure_logged_in(online_app, login_wait_seconds=30):
    """Idempotently log into the device. In persistent mode the login state
    survives across calls and this is a no-op via online_app.is_logged_in.
    In headless mode each tool call spawns a fresh CODESYS process, so any
    online tool (start_stop, read_variable, write_variable,
    read_running_version_online) needs to log in itself before its action.

    Without this helper, tools other than connect_to_device + download_to_device
    fail in headless mode with 'Application not logged in.' (start/stop) or
    'Invalid expression' (read/write).

    Logs in with OnlineChangeOption.Keep only (login_without_download): it
    never downloads, also when the project differs from the PLC."""
    import scriptengine as _se  # local import; ensure_online_connection.py
                                # is concatenated into the script body so
                                # the top-level import in the main script
                                # is also visible, but keep this defensive.
    # Short-circuit: already logged in (persistent mode).
    if hasattr(online_app, 'is_logged_in'):
        try:
            if online_app.is_logged_in:
                print("DEBUG: ensure_logged_in: already logged in (persistent session).")
                return
        except Exception as e:
            print("DEBUG: ensure_logged_in: is_logged_in property raised: %s" % e)

    if not hasattr(online_app, 'login'):
        raise TypeError("Online application does not support login().")

    # Keep only: never a download from a read, write or start/stop (see login_without_download)
    login_without_download(online_app, "ensure_logged_in")

    # Settle wait. Same STABLE_STATES as connect_to_device.
    STABLE_STATES = ('run', 'stop', 'connected', 'halt', 'breakpoint')
    state = "unknown"
    for elapsed in range(login_wait_seconds):
        if hasattr(online_app, 'application_state'):
            try:
                state = str(online_app.application_state)
            except Exception:
                pass
        if state.lower() in STABLE_STATES:
            print("DEBUG: ensure_logged_in: state stabilised at '%s' after %ds" % (state, elapsed))
            return
        try:
            _se.system.delay(1000)
        except Exception:
            pass
    print("DEBUG: ensure_logged_in: state did not stabilise within %ds (last='%s'); proceeding anyway." % (login_wait_seconds, state))
# --- End of ensure_logged_in function ---
