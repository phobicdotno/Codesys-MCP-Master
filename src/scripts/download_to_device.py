import sys, scriptengine as script_engine, os, traceback

LOGIN_WAIT_SECONDS = {LOGIN_WAIT_SECONDS}


def _progress(stage):
    # Each stage restarts the MCP's timeout (mcp_progress comes from the IPC
    # preamble), so the timeout covers the transfer, not the open and build
    # before it. Without the preamble (headless) this does nothing.
    try:
        mcp_progress(stage)
    except NameError:
        pass


try:
    print("DEBUG: download_to_device script: Project='%s', LoginWaitSec=%d" % (
        PROJECT_FILE_PATH, LOGIN_WAIT_SECONDS))
    register_device_credentials_if_set()
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    _progress('project open')

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()

    # Build first, as a stage of its own: login() builds anyway when the
    # code is not current, and on a freshly opened project that took minutes
    # of the download's time (2026-10-18). A build error still surfaces at
    # login, so a failure here only logs.
    _progress('build')
    try:
        target_app.build()
        print("DEBUG: build() done before login")
    except Exception as be:
        print("DEBUG: build() before login failed (%s); login() builds instead" % be)
    _progress('login and transfer')

    # Login. Same SP-version drift as connect_to_device: TryOnlineChange
    # is gone, login() now requires (OnlineChangeOption, bool) on SP21+.
    # Use the same defensive probe + post-login wait pattern.
    print("DEBUG: Logging in for download...")
    if not hasattr(online_app, 'login'):
        raise TypeError("Online application does not support login().")

    enum_candidates = []
    if hasattr(script_engine, 'OnlineChangeOption'):
        oc = script_engine.OnlineChangeOption
        oc_members = sorted([m for m in dir(oc) if not m.startswith('_')])
        print("DEBUG: OnlineChangeOption members: %s" % oc_members)
        # For download we prefer 'WithDownload' / 'ForceDownload' over 'Try'
        for preferred in ('WithDownload', 'ForceDownload', 'Try',
                          'TryOnlineChange', 'OnlineChangeOnly', 'None_', 'None'):
            if preferred in oc_members:
                try:
                    enum_candidates.append((preferred, getattr(oc, preferred)))
                except Exception:
                    pass
        for m in oc_members:
            if m not in [n for n, _ in enum_candidates]:
                try:
                    enum_candidates.append((m, getattr(oc, m)))
                except Exception:
                    pass

    call_shapes = []
    for nm, val in enum_candidates:
        call_shapes.append(("login(%s, False)" % nm, (val, False)))
        call_shapes.append(("login(%s, True)" % nm, (val, True)))
        call_shapes.append(("login(%s)" % nm, (val,)))
    call_shapes.append(("login(False)", (False,)))
    call_shapes.append(("login(True)", (True,)))
    call_shapes.append(("login()", ()))

    last_err = None
    logged_in = False
    for desc, args in call_shapes:
        try:
            online_app.login(*args)
            print("DEBUG: %s succeeded" % desc)
            logged_in = True
            break
        except Exception as e:
            last_err = e
            print("DEBUG: %s failed: %s: %s" % (desc, type(e).__name__, e))
            # A TypeError means this call shape does not fit the SP's login()
            # signature: try the next one. Any other exception means the shape
            # was accepted and the login itself failed (no gateway, refused,
            # K-bus mismatch, a prompt answered by the script engine). Stop
            # there: every further accepted shape logs in again and can run a
            # full download each time and keeps the IDE busy for minutes.
            # (A single full download over a slow tunnel already takes about
            # two minutes and the PLC logs one "Download successful" line per
            # chunk, every few seconds: that is not a loop.)
            if not isinstance(e, TypeError):
                break

    if not logged_in:
        raise RuntimeError("Login failed: %s" % last_err)

    # Wait for state to stabilise (credential dialog handling)
    print("DEBUG: login() returned. Waiting up to %d seconds for state to stabilise" % LOGIN_WAIT_SECONDS)
    STABLE_STATES = ('run', 'stop', 'connected', 'halt', 'breakpoint')
    for elapsed in range(LOGIN_WAIT_SECONDS):
        state = "unknown"
        if hasattr(online_app, 'application_state'):
            try:
                state = str(online_app.application_state)
            except Exception:
                pass
        if state.lower() in STABLE_STATES:
            print("DEBUG: state stabilised at '%s' after %ds" % (state, elapsed))
            break
        try:
            script_engine.system.delay(1000)
        except Exception:
            pass

    # Download
    _progress('download')
    print("DEBUG: Calling download()...")
    if hasattr(online_app, 'download'):
        online_app.download()
        print("DEBUG: Download complete.")
    elif hasattr(online_app, 'create_boot_application'):
        # Alternative: some versions use create_boot_application
        online_app.create_boot_application()
        print("DEBUG: Boot application created.")
    else:
        raise TypeError("Online application does not support download().")

    print("Downloaded to device for application: %s" % app_name)
    print("SCRIPT_SUCCESS: Application downloaded to device successfully.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error downloading to device for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
