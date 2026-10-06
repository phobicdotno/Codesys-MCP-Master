import sys, scriptengine as script_engine, os, traceback

DIRECTION = "{DIRECTION}"
LOCAL_PATH = r"{LOCAL_PATH}"
PLC_PATH = {PLC_PATH}
FORCE_OVERWRITE = {FORCE_OVERWRITE}

try:
    print("DEBUG: plc_file_transfer script: direction='%s', local='%s', plc='%s', overwrite=%s, Project='%s'" % (
        DIRECTION, LOCAL_PATH, PLC_PATH, FORCE_OVERWRITE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    direction = DIRECTION.lower().strip()
    if direction not in ('to_plc', 'from_plc'):
        raise ValueError("Invalid direction '%s'. Must be 'to_plc' or 'from_plc'." % DIRECTION)
    if not LOCAL_PATH or not PLC_PATH:
        raise ValueError("Both localPath and plcPath are required.")

    online_app, target_app = ensure_online_connection(primary_project)
    app_name = getattr(target_app, 'get_name', lambda: "Unknown")()
    ensure_logged_in(online_app)

    online_device = online_app.get_online_device()
    if direction == 'to_plc':
        if not os.path.isfile(LOCAL_PATH):
            raise ValueError("Local file does not exist: %s" % LOCAL_PATH)
        # CODESYS naming: download_file = PC -> PLC.
        online_device.download_file(LOCAL_PATH, PLC_PATH, FORCE_OVERWRITE)
        print("DEBUG: download_file (PC -> PLC) OK")
    else:
        # upload_file = PLC -> PC.
        online_device.upload_file(PLC_PATH, LOCAL_PATH, FORCE_OVERWRITE)
        print("DEBUG: upload_file (PLC -> PC) OK")

    print("Direction: %s" % direction)
    print("Local: %s" % LOCAL_PATH)
    print("PLC: %s" % PLC_PATH)
    print("Application: %s" % app_name)
    print("SCRIPT_SUCCESS: File transfer (%s) completed." % direction)
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error transferring file (%s) for project %s: %s\n%s" % (
        DIRECTION, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
