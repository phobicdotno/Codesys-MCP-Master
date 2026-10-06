import sys, scriptengine as script_engine, os, traceback

RESET_LEVEL = "{RESET_LEVEL}"

try:
    print("DEBUG: reset_application script: Level='%s', Project='%s'" % (RESET_LEVEL, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    level = RESET_LEVEL.lower().strip()
    if level not in ('warm', 'cold', 'origin'):
        raise ValueError("Invalid reset level '%s'. Must be 'warm', 'cold' or 'origin'." % RESET_LEVEL)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    # ResetOption enum (SP21 ScriptOnline.pyi): Warm / Cold / Original.
    reset_option_enum = getattr(script_engine, 'ResetOption', None)
    if reset_option_enum is None:
        raise TypeError("scriptengine.ResetOption is not available on this SP.")
    opt_map = {'warm': 'Warm', 'cold': 'Cold', 'origin': 'Original'}
    reset_option = getattr(reset_option_enum, opt_map[level])

    print("DEBUG: Calling reset(%s)..." % opt_map[level])
    online_app.reset(reset_option)
    print("DEBUG: Reset done.")

    state = "unknown"
    try:
        state = str(online_app.application_state)
    except Exception:
        pass

    print("Reset Level: %s" % level)
    print("Application: %s" % app_name)
    print("State After: %s" % state)
    print("SCRIPT_SUCCESS: Application reset (%s) executed." % level)
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error resetting application (level '%s') in project %s: %s\n%s" % (
        RESET_LEVEL, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
