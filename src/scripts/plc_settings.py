import sys, scriptengine as script_engine, os, traceback

# Reads (and with APPLY=True writes) the device's PLC settings tab via
# device.driver_info (IScriptDriverInfo): bus cycle task, update IOs while
# in stop, behaviour for outputs on stop, always update variables, force
# variables for IO mapping, diagnosis, IO warnings as errors.
# None / empty string = leave unchanged.

DEVICE_PATH = "{DEVICE_PATH}"
APPLY = {APPLY}
BUS_CYCLE_TASK = {BUS_CYCLE_TASK}
UPDATE_IOS_WHILE_IN_STOP = {UPDATE_IOS_WHILE_IN_STOP}
OUTPUTS_ON_STOP = "{OUTPUTS_ON_STOP}"
STOP_RESET_PROGRAM = {STOP_RESET_PROGRAM}
ALWAYS_UPDATE_VARIABLES = "{ALWAYS_UPDATE_VARIABLES}"
GENERATE_FORCE_VARIABLES = {GENERATE_FORCE_VARIABLES}
ENABLE_DIAGNOSIS = {ENABLE_DIAGNOSIS}
IO_WARNINGS_AS_ERRORS = {IO_WARNINGS_AS_ERRORS}

_OUTS = {'keep': 'KeepCurrentValues', 'default': 'SetToDefault', 'program': 'ExecuteProgram'}
_ALWAYS = {'disabled': 'Disabled', 'only_if_unused': 'OnlyIfUnused', 'always': 'AlwaysInBusCycle'}

def _enum_name(v):
    return str(v).split('.')[-1]

def _dump(di):
    print("Bus cycle task: %s" % (di.bus_cycle_task_by_name or '<unspecified>'))
    print("Update IOs while in stop: %s" % di.update_ios_while_in_stop)
    print("Behaviour for outputs on stop: %s" % _enum_name(di.behaviour_for_outputs_on_stop))
    print("Program for stop reset behaviour: %s" % (di.user_program_for_stop_reset_behaviour or ''))
    print("Always update variables: %s" % _enum_name(di.always_update_variables))
    print("Generate force variables for IO mapping: %s" % di.generate_force_variables)
    print("Enable diagnosis for devices: %s" % di.enable_diagnosis)
    print("Show IO warnings as errors: %s" % di.show_io_warnings_as_errors)

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    dev = find_device_object(primary_project, DEVICE_PATH)
    dev_name = dev.get_name()
    di = getattr(dev, 'driver_info', None)
    if di is None:
        raise TypeError("Device '%s' has no PLC settings (driver_info) on this CODESYS version." % dev_name)

    changed = []
    if APPLY:
        # Validate everything before the first write.
        if OUTPUTS_ON_STOP and OUTPUTS_ON_STOP.lower() not in _OUTS:
            raise ValueError("outputsOnStop must be keep, default or program.")
        if OUTPUTS_ON_STOP.lower() == 'program' and not (STOP_RESET_PROGRAM or di.user_program_for_stop_reset_behaviour):
            raise ValueError("outputsOnStop=program needs stopResetProgram.")
        if ALWAYS_UPDATE_VARIABLES and ALWAYS_UPDATE_VARIABLES.lower() not in _ALWAYS:
            raise ValueError("alwaysUpdateVariables must be disabled, only_if_unused or always.")
        if BUS_CYCLE_TASK is not None:
            di.set_bus_cycle_task(BUS_CYCLE_TASK)
            changed.append("busCycleTask=%s" % (BUS_CYCLE_TASK or '<unspecified>'))
        if UPDATE_IOS_WHILE_IN_STOP is not None:
            di.update_ios_while_in_stop = UPDATE_IOS_WHILE_IN_STOP
            changed.append("updateIosWhileInStop=%s" % UPDATE_IOS_WHILE_IN_STOP)
        if STOP_RESET_PROGRAM is not None:
            di.user_program_for_stop_reset_behaviour = STOP_RESET_PROGRAM
            changed.append("stopResetProgram=%s" % STOP_RESET_PROGRAM)
        if OUTPUTS_ON_STOP:
            di.behaviour_for_outputs_on_stop = getattr(script_engine.StopResetBehaviour, _OUTS[OUTPUTS_ON_STOP.lower()])
            changed.append("outputsOnStop=%s" % OUTPUTS_ON_STOP.lower())
        if ALWAYS_UPDATE_VARIABLES:
            di.always_update_variables = getattr(script_engine.AlwaysUpdateVariablesMode, _ALWAYS[ALWAYS_UPDATE_VARIABLES.lower()])
            changed.append("alwaysUpdateVariables=%s" % ALWAYS_UPDATE_VARIABLES.lower())
        if GENERATE_FORCE_VARIABLES is not None:
            di.generate_force_variables = GENERATE_FORCE_VARIABLES
            changed.append("generateForceVariables=%s" % GENERATE_FORCE_VARIABLES)
        if ENABLE_DIAGNOSIS is not None:
            di.enable_diagnosis = ENABLE_DIAGNOSIS
            changed.append("enableDiagnosis=%s" % ENABLE_DIAGNOSIS)
        if IO_WARNINGS_AS_ERRORS is not None:
            di.show_io_warnings_as_errors = IO_WARNINGS_AS_ERRORS
            changed.append("ioWarningsAsErrors=%s" % IO_WARNINGS_AS_ERRORS)
        if not changed:
            raise ValueError("Nothing to set: all fields empty.")
        primary_project.save()

    print("### PLC_SETTINGS_START ###")
    print("Device: %s" % dev_name)
    _dump(dev.driver_info)
    if changed:
        print("Changed: %s" % ", ".join(changed))
    print("### PLC_SETTINGS_END ###")
    print("SCRIPT_SUCCESS: %s" % ("PLC settings set. Project saved." if APPLY else "PLC settings read."))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in PLC settings for device '%s' in project %s: %s\n%s" % (DEVICE_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
