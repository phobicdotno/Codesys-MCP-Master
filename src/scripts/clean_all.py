import sys, scriptengine as script_engine, os, traceback

try:
    print("DEBUG: clean_all script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    primary_project.clean_all()
    print("SCRIPT_SUCCESS: Clean All executed (compile info removed for all applications).")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error running Clean All for %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
