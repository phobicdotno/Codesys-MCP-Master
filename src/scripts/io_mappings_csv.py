import sys, scriptengine as script_engine, os, traceback

DEVICE_PATH = "{DEVICE_PATH}"
CSV_PATH = r"{CSV_PATH}"
DIRECTION = "{DIRECTION}"

try:
    print("DEBUG: io_mappings_csv script: Device='%s', Csv='%s', Direction='%s', Project='%s'" % (
        DEVICE_PATH, CSV_PATH, DIRECTION, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    direction = DIRECTION.lower().strip()
    if direction not in ('export', 'import'):
        raise ValueError("Invalid direction '%s'. Must be 'export' or 'import'." % DIRECTION)
    if not CSV_PATH:
        raise ValueError("CSV path empty.")
    device = find_device_object(primary_project, DEVICE_PATH)
    dev_name = getattr(device, 'get_name', lambda: "Unknown")()

    if direction == 'export':
        if not hasattr(device, 'export_io_mappings_as_csv'):
            raise TypeError("Device '%s' does not support export_io_mappings_as_csv (needs 3.5.8.0+)." % dev_name)
        device.export_io_mappings_as_csv(CSV_PATH)
        size_note = "unknown"
        try:
            size_note = "%s bytes" % os.path.getsize(CSV_PATH)
        except Exception:
            pass
        print("Device: %s" % dev_name)
        print("CSV: %s (%s)" % (CSV_PATH, size_note))
        print("SCRIPT_SUCCESS: IO mappings exported to CSV.")
    else:
        if not os.path.isfile(CSV_PATH):
            raise ValueError("CSV file does not exist: %s" % CSV_PATH)
        if not hasattr(device, 'import_io_mappings_from_csv'):
            raise TypeError("Device '%s' does not support import_io_mappings_from_csv (needs 3.5.8.0+)." % dev_name)
        device.import_io_mappings_from_csv(CSV_PATH)
        primary_project.save()
        print("Device: %s" % dev_name)
        print("CSV: %s" % CSV_PATH)
        print("SCRIPT_SUCCESS: IO mappings imported from CSV. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in IO-mappings CSV %s for project %s: %s\n%s" % (
        DIRECTION, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
