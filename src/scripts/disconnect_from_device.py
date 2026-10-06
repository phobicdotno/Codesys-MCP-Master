import sys, scriptengine as script_engine, os, traceback

try:
    print("DEBUG: disconnect_from_device script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()

    # Logout from the device
    print("DEBUG: Calling logout() on online application...")

    if hasattr(online_app, 'logout'):
        online_app.logout()
        print("DEBUG: Logout successful.")
    else:
        raise TypeError("Online application does not support logout().")

    print("Disconnected from device for application: %s" % app_name)
    print("SCRIPT_SUCCESS: Disconnected from device successfully.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error disconnecting from device for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
