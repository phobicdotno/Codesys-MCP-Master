import sys, scriptengine as script_engine, os, traceback

# set_simulation_mode: read or set a device's simulation mode
# (IScriptDeviceObject.get_simulation_mode / set_simulation_mode). In
# simulation the application runs in CODESYS's built-in simulator instead
# of on the PLC, so it can be tested without hardware. Changed offline
# (log out first); the project is saved after a change.
DEVICE_PATH = {DEVICE_PATH_PY}
ENABLE = {ENABLE}  # None = only report

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    dev = find_device_object(primary_project, DEVICE_PATH)
    name = dev.get_name() if hasattr(dev, "get_name") else "?"
    if not hasattr(dev, "get_simulation_mode"):
        raise RuntimeError("This CODESYS version has no simulation-mode scripting call on devices.")
    before = bool(dev.get_simulation_mode())
    after = before
    if ENABLE is not None and bool(ENABLE) != before:
        dev.set_simulation_mode(bool(ENABLE))
        after = bool(dev.get_simulation_mode())
        if after != bool(ENABLE):
            raise RuntimeError("Simulation mode did not change (is the application still logged in?).")
        primary_project.save()
    print("Device: %s" % name)
    print("Simulation mode: %s%s" % ("ON" if after else "OFF",
                                    "" if after == before else " (was %s)" % ("ON" if before else "OFF")))
    print("SCRIPT_SUCCESS: simulation mode %s." % ("ON" if after else "OFF"))
    sys.exit(0)
except Exception as e:
    msg = "Error with simulation mode in %s: %s\n%s" % (PROJECT_FILE_PATH, e, traceback.format_exc())
    print(msg)
    print("SCRIPT_ERROR: %s" % msg)
    sys.exit(1)
