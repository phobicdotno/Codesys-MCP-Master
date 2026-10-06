import sys, scriptengine as script_engine, os, traceback

# List of (expression, value) string tuples.
ASSIGNMENTS = {ASSIGNMENTS_PY}

try:
    print("DEBUG: force_variables script: %d assignment(s), Project='%s'" % (len(ASSIGNMENTS), PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not ASSIGNMENTS:
        raise ValueError("Assignments list empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    # Prepare each value, then commit the batch as FORCE (value is pinned
    # against task writes until unforced).
    for expr, val in ASSIGNMENTS:
        online_app.set_prepared_value(expr, val)
        print("DEBUG: prepared %s = %s" % (expr, val))
    online_app.force_prepared_values()
    print("DEBUG: force_prepared_values OK")

    forced_now = []
    try:
        forced_now = list(online_app.get_forced_expressions() or [])
    except Exception as e:
        print("DEBUG: get_forced_expressions failed after force: %s" % e)

    print("### FORCED_START ###")
    for expr, val in ASSIGNMENTS:
        print("%s = %s" % (expr, val))
    print("### FORCED_END ###")
    print("Total Forced On App: %d" % len(forced_now))
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Forced %d variable(s)." % len(ASSIGNMENTS))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    failed = getattr(e, 'failed_expressions', None)
    failed_note = ("\nFailed expressions: %s" % list(failed)) if failed else ""
    error_message = "Error forcing variables in project %s: %s%s\n%s" % (
        PROJECT_FILE_PATH, e, failed_note, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
