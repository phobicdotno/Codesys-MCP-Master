import sys, scriptengine as script_engine, os, traceback

# Empty list = unforce ALL forced values on the application.
EXPRESSIONS = {EXPRESSIONS_PY}
RESTORE = {RESTORE}

try:
    print("DEBUG: unforce_variables script: %d expression(s) (empty=all), restore=%s, Project='%s'" % (
        len(EXPRESSIONS), RESTORE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    if not EXPRESSIONS:
        online_app.unforce_all_values()
        print("DEBUG: unforce_all_values OK")
        print("Unforced: ALL")
    else:
        # set_unforce_value stages the unforce; force_prepared_values commits it.
        for expr in EXPRESSIONS:
            online_app.set_unforce_value(expr, RESTORE)
            print("DEBUG: staged unforce for %s" % expr)
        online_app.force_prepared_values()
        print("DEBUG: force_prepared_values (commit unforce) OK")
        print("Unforced: %d expression(s)" % len(EXPRESSIONS))

    remaining = []
    try:
        remaining = list(online_app.get_forced_expressions() or [])
    except Exception as e:
        print("DEBUG: get_forced_expressions failed after unforce: %s" % e)
    print("Still Forced: %d" % len(remaining))
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Unforce executed.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error unforcing variables in project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
