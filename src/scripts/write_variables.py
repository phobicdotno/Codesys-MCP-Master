import sys, scriptengine as script_engine, os, traceback

# List of (expression, value) string tuples.
ASSIGNMENTS = {ASSIGNMENTS_PY}

try:
    print("DEBUG: write_variables script: %d assignment(s), Project='%s'" % (len(ASSIGNMENTS), PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not ASSIGNMENTS:
        raise ValueError("Assignments list empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    # Two-step prepare-then-commit (same pattern as write_variable, but one
    # commit for the whole batch so all values land in the same cycle).
    for expr, val in ASSIGNMENTS:
        online_app.set_prepared_value(expr, val)
        print("DEBUG: prepared %s = %s" % (expr, val))
    online_app.write_prepared_values()
    print("DEBUG: write_prepared_values OK")

    print("### WRITTEN_START ###")
    for expr, val in ASSIGNMENTS:
        print("%s = %s" % (expr, val))
    print("### WRITTEN_END ###")
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Wrote %d variable(s)." % len(ASSIGNMENTS))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    failed = getattr(e, 'failed_expressions', None)
    failed_note = ("\nFailed expressions: %s" % list(failed)) if failed else ""
    error_message = "Error writing variables in project %s: %s%s\n%s" % (
        PROJECT_FILE_PATH, e, failed_note, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
