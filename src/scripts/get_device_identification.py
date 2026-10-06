import sys, scriptengine as script_engine, os, traceback

DEVICE_PATH = "{DEVICE_PATH}"

try:
    print("DEBUG: get_device_identification script: Device='%s', Project='%s'" % (DEVICE_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    device = find_device_object(primary_project, DEVICE_PATH)
    dev_name = getattr(device, 'get_name', lambda: "Unknown")()

    print("### DEVICE_ID_START ###")
    print("Device: %s" % dev_name)
    try:
        dev_id = device.get_device_identification()
        for attr in ('type', 'id', 'version'):
            try:
                print("%s: %s" % (attr, getattr(dev_id, attr)))
            except Exception as e:
                print("%s: <unavailable: %s>" % (attr, e))
    except Exception as e:
        print("identification: <unavailable: %s>" % e)
    for attr in ('device_name', 'device_address'):
        try:
            print("%s: %s" % (attr, getattr(device, attr)))
        except Exception:
            pass
    try:
        enabled = device.is_enabled()
        print("enabled: %s" % enabled)
    except Exception:
        pass
    try:
        sim = device.get_simulation_mode()
        print("simulation: %s" % sim)
    except Exception:
        pass
    print("### DEVICE_ID_END ###")
    print("SCRIPT_SUCCESS: Device identification read.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error reading device identification in project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
