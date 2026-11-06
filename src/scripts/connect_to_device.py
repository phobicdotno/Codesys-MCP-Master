import sys, scriptengine as script_engine, os, traceback

LOGIN_WAIT_SECONDS = {LOGIN_WAIT_SECONDS}

try:
    print("DEBUG: connect_to_device script: Project='%s', LoginWaitSec=%d" % (
        PROJECT_FILE_PATH, LOGIN_WAIT_SECONDS))
    register_device_credentials_if_set()
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()

    # Login WITHOUT download (OnlineChangeOption.Keep only, see
    # login_without_download in ensure_online_connection.py). A connect never
    # changes the program on the PLC, also when this project differs from it;
    # it warns instead. Changing the PLC is download_to_device's job.
    print("DEBUG: Calling login() on online application (Keep, no download)...")
    login_without_download(online_app, "connect_to_device")
    version_warning = warn_if_plc_runs_other_version(online_app, target_app, "connect_to_device")
    if version_warning:
        print(version_warning)
    print("DEBUG: login() returned. Waiting up to %d seconds for state to stabilise" % LOGIN_WAIT_SECONDS)

    # Poll application_state. login() may return before the application
    # state has settled. Pump the message loop via system.delay() and exit
    # early once the state lands on a recognisable terminal value. With
    # deviceUser/devicePassword injected (register_device_credentials_if_set)
    # no login dialog appears; without them CODESYS falls back to its dialog.
    STABLE_STATES = ('run', 'stop', 'connected', 'halt', 'breakpoint')
    state = "unknown"
    for elapsed in range(LOGIN_WAIT_SECONDS):
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

    print("Connected to device for application: %s" % app_name)
    print("Application State: %s" % state)
    if version_warning:
        print(version_warning)
    print("SCRIPT_SUCCESS: Connected to device successfully.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error connecting to device for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
