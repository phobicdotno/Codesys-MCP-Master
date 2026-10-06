import sys, scriptengine as script_engine, os, traceback

PLC_DIRECTORY = {PLC_DIRECTORY}

try:
    print("DEBUG: plc_file_list script: dir='%s', Project='%s'" % (PLC_DIRECTORY, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    online_device = online_app.get_online_device()
    entries = online_device.get_file_list_of_directory(PLC_DIRECTORY)
    entries = list(entries or [])

    print("### FILES_START ###")
    for info in entries:
        try:
            kind = "dir" if info.is_directory else "file"
            # size can be an IronPython long -- format with %s, never json.
            size = info.size if not info.is_directory else 0
            mtime = str(info.last_modification_time)
            print("%s\t%s\t%s\t%s" % (kind, info.name, size, mtime))
        except Exception as e:
            print("?\t%s\t-\t<info error: %s>" % (getattr(info, 'name', '?'), e))
    print("### FILES_END ###")
    print("Entry Count: %d" % len(entries))
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: Listed %d entries in '%s'." % (len(entries), PLC_DIRECTORY or '<root>'))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error listing PLC directory '%s' for project %s: %s\n%s" % (
        PLC_DIRECTORY, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
