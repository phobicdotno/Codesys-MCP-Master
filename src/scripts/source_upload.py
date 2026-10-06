import sys, scriptengine as script_engine, os, traceback

ARCHIVE_PATH = r"{ARCHIVE_PATH}"

try:
    print("DEBUG: source_upload script: archive='%s', Project='%s'" % (ARCHIVE_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not ARCHIVE_PATH:
        raise ValueError("Archive path empty.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    online_device = online_app.get_online_device()
    online_device.upload_source(ARCHIVE_PATH)
    print("DEBUG: upload_source OK")

    print("Archive: %s" % ARCHIVE_PATH)
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Source archive uploaded from device.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error uploading source from device for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
