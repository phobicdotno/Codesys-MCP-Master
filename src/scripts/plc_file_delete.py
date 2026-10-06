import sys, scriptengine as script_engine, os, traceback

PLC_PATH = {PLC_PATH}
IS_DIRECTORY = {IS_DIRECTORY}
RECURSIVE = {RECURSIVE}

try:
    print("DEBUG: plc_file_delete script: path='%s', isDir=%s, recursive=%s, Project='%s'" % (
        PLC_PATH, IS_DIRECTORY, RECURSIVE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not PLC_PATH:
        raise ValueError("PLC path empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    online_device = online_app.get_online_device()
    if IS_DIRECTORY:
        online_device.delete_directory(PLC_PATH, RECURSIVE)
        print("DEBUG: delete_directory OK")
        print("Deleted Directory: %s (recursive=%s)" % (PLC_PATH, RECURSIVE))
    else:
        online_device.delete_file(PLC_PATH)
        print("DEBUG: delete_file OK")
        print("Deleted File: %s" % PLC_PATH)

    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: PLC delete executed.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error deleting '%s' on PLC for project %s: %s\n%s" % (
        PLC_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
