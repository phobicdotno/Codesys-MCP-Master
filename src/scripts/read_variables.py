import sys, scriptengine as script_engine, os, traceback

EXPRESSIONS = {EXPRESSIONS_PY}

try:
    print("DEBUG: read_variables script: %d expression(s), Project='%s'" % (len(EXPRESSIONS), PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not EXPRESSIONS:
        raise ValueError("Expressions list empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    values = None
    if hasattr(online_app, 'read_values'):
        try:
            values = online_app.read_values(EXPRESSIONS)
            print("DEBUG: read_values returned %d value(s)" % (len(values) if values is not None else 0))
        except Exception as e:
            print("DEBUG: read_values failed, falling back to per-expression read_value: %s" % e)
            values = None

    if values is None:
        values = []
        for expr in EXPRESSIONS:
            try:
                values.append(online_app.read_value(expr))
            except Exception as e:
                values.append("<read failed: %s>" % e)

    print("### VALUES_START ###")
    for i in range(len(EXPRESSIONS)):
        val = values[i] if i < len(values) else None
        print("%s = %s" % (EXPRESSIONS[i], val))
    print("### VALUES_END ###")
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Read %d variable(s)." % len(EXPRESSIONS))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error reading variables in project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
