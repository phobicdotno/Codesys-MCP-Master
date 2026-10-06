import sys, scriptengine as script_engine, os, traceback

DEVICE_PATH = "{DEVICE_PATH}"
ACTION = "{ACTION}"

try:
    print("DEBUG: set_device_state script: Device='%s', Action='%s', Project='%s'" % (
        DEVICE_PATH, ACTION, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    action = ACTION.lower().strip()
    if action not in ('enable', 'disable', 'simulation_on', 'simulation_off'):
        raise ValueError("Invalid action '%s'." % ACTION)
    device = find_device_object(primary_project, DEVICE_PATH)
    dev_name = getattr(device, 'get_name', lambda: "Unknown")()

    if action == 'enable':
        device.enable()
    elif action == 'disable':
        device.disable()
    elif action == 'simulation_on':
        device.set_simulation_mode(True)
    else:
        device.set_simulation_mode(False)
    primary_project.save()

    enabled_note = "unknown"
    try:
        enabled_note = str(device.is_enabled())
    except Exception:
        pass
    sim_note = "unknown"
    try:
        sim_note = str(device.get_simulation_mode())
    except Exception:
        pass

    print("Device: %s" % dev_name)
    print("Action: %s" % action)
    print("Enabled: %s" % enabled_note)
    print("Simulation: %s" % sim_note)
    print("SCRIPT_SUCCESS: Device state changed. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error changing device state in project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
