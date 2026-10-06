import sys, scriptengine as script_engine, os, traceback

try:
    print("DEBUG: list_forced_variables script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    forced = list(online_app.get_forced_expressions() or [])
    prepared = []
    try:
        prepared = list(online_app.get_prepared_expressions() or [])
    except Exception as e:
        print("DEBUG: get_prepared_expressions failed: %s" % e)

    print("### FORCED_START ###")
    for expr in forced:
        print("forced: %s" % expr)
    for expr in prepared:
        print("prepared: %s" % expr)
    print("### FORCED_END ###")
    print("Forced Count: %d" % len(forced))
    print("Prepared Count: %d" % len(prepared))
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Listed forced/prepared expressions.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error listing forced variables in project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
