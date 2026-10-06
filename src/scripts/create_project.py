import sys, scriptengine as script_engine, os, time, traceback

# Placeholders
PROJECT_FILE_PATH = r'{PROJECT_FILE_PATH}'          # Path for the new project (Target Path)
DEVICE_NAME = r'{DEVICE_NAME}'                       # Substring of the device's display name (e.g. "CODESYS Control Win V3 x64").
DEFAULT_DEVICE = 'CODESYS Control Win V3 x64'        # Used when DEVICE_NAME is empty.

# Builds the project with the scripting API instead of copying the install's
# Templates/Standard.project. Those templates are stored in an older format
# (SP18/SP19: CoDeSys V3.1 SP3 with a PLCWinNT device; SP21/SP22: SP19 Patch 4),
# so opening a copy pops "Do you want to upgrade the storage format?". That
# prompt is shown by FileCommands directly, not through the script prompt
# handler: prompt_handling None / ProcessScriptPrompts / LogMessageKeys do not
# reach it (tested on SP18, 2026-10-05), and the watcher hangs on it.
# projects.create() writes the current format, and adding a PLC device
# creates Plc Logic / Application / Library Manager by itself. On top of that
# this adds what the standard template has: PLC_PRG and a Task Configuration
# with MainTask calling PLC_PRG.


def _ide_version():
    """(major, minor, sp, patch) of the running CODESYS, from its install
    directory name ('CODESYS 3.5.18.50'), or None."""
    try:
        import System
        exe = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName
        import re
        m = re.search(r'CODESYS (\d+)\.(\d+)\.(\d+)\.(\d+)', exe)
        if m:
            return tuple(int(x) for x in m.groups())
    except Exception as e:
        print("DEBUG: could not read the CODESYS version: %s" % e)
    return None


def _version_key(dev):
    try:
        return tuple(int(p) for p in str(dev.device_id.version).split('.'))
    except Exception:
        return (0,)


def _resolve_device_by_name(name):
    """Device repository entry whose display name contains `name`. Prefers
    the newest version not newer than the running CODESYS (an SP18 project
    gets the 3.5.18 description when it is installed), else the newest."""
    repo = None
    try:
        repo = script_engine.device_repository
    except Exception as e:
        print("DEBUG: script_engine.device_repository unavailable: %s" % e)
    if repo is None:
        try:
            repo = device_repository  # noqa: F821 -- builtin if injected
        except NameError:
            return None
    try:
        candidates = list(repo.get_all_devices(name, None))
    except Exception as e:
        print("DEBUG: device_repository.get_all_devices(name, None) failed: %s" % e)
        return None
    if not candidates:
        return None
    # get_all_devices matches substrings: 'Ethernet' also returns
    # 'EtherNet/IP Scanner' etc., and the newest of those used to win.
    # A device whose name is exactly the one asked for comes first.
    try:
        _exact = [d for d in candidates if str(d.device_info.name).strip().lower() == name.strip().lower()]
    except Exception:
        _exact = []
    if _exact:
        candidates = _exact
    for d in candidates:
        try:
            print("DEBUG: candidate device: name='%s', version=%s" % (d.device_info.name, d.device_id.version))
        except Exception:
            pass
    candidates.sort(key=_version_key)
    ide = _ide_version()
    if ide:
        fitting = [d for d in candidates if _version_key(d)[:4] <= ide]
        if fitting:
            return fitting[-1]
    return candidates[-1]


try:
    device_name = DEVICE_NAME or DEFAULT_DEVICE
    print("DEBUG: create_project: Target=%s Device=%s" % (PROJECT_FILE_PATH, device_name))
    if not PROJECT_FILE_PATH:
        raise ValueError("Target project file path empty.")

    # projects.create refuses while another project is primary. Close it
    # first, with the same rule as ensure_project_open: never save it here,
    # and refuse if it is dirty so nobody's unsaved work is dropped.
    prior = None
    try:
        prior = script_engine.projects.primary
    except Exception as primary_err:
        print("WARN: Could not read primary project (%s). Assuming none." % primary_err)
    if prior:
        prior_dirty = False
        try:
            prior_dirty = bool(prior.dirty)
        except Exception as dirty_err:
            print("WARN: Could not read dirty flag of open project (%s). Treating it as unsaved." % dirty_err)
            prior_dirty = True  # unknown is never clean: refuse rather than lose work
        if prior_dirty:
            raise RuntimeError(
                "Refusing to create a project: the open project '%s' has UNSAVED changes. "
                "Save them first (save_project) or discard them (close_project with saveFirst=false), "
                "then retry." % prior.path)
        print("DEBUG: Closing open project '%s' before creating the new one." % prior.path)
        prior.close()

    device = _resolve_device_by_name(device_name)
    if device is None:
        msg = ("Device '%s' not found in the local device repository. Open the IDE's "
               "Device Repository (Tools > Device Repository) to confirm the exact display name." % device_name)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    target_dir = os.path.dirname(PROJECT_FILE_PATH)
    if target_dir and not os.path.exists(target_dir):
        os.makedirs(target_dir)
    if os.path.exists(PROJECT_FILE_PATH):
        print("WARN: Target project file already exists, overwriting: %s" % PROJECT_FILE_PATH)
        os.remove(PROJECT_FILE_PATH)

    project = script_engine.projects.create(PROJECT_FILE_PATH, True)
    if not project:
        print("SCRIPT_ERROR: projects.create returned None for %s" % PROJECT_FILE_PATH)
        sys.exit(1)

    dev_id = device.device_id
    print("DEBUG: Adding device '%s' (type=%s id=%s version=%s)" % (
        device.device_info.name, dev_id.type, dev_id.id, dev_id.version))
    project.add('Device', dev_id)

    apps = project.find('Application', True)
    if not apps:
        raise RuntimeError("Device '%s' brought no Application (not a PLC device?)." % device.device_info.name)
    app = apps[0]
    app.create_pou('PLC_PRG', script_engine.PouType.Program)
    task_config = app.create_task_configuration()
    try:
        # The standard template names it 'Task Configuration'; the task tools
        # look it up by that name.
        task_config.rename('Task Configuration')
    except Exception as rename_err:
        print("WARN: Could not rename the task configuration: %s" % rename_err)
    task = task_config.create_task('MainTask')
    task.pous.add('PLC_PRG')

    project.save()
    print("DEBUG: Project saved.")
    print("Project created at: %s" % PROJECT_FILE_PATH)
    print("Device: %s %s" % (device.device_info.name, dev_id.version))
    print("SCRIPT_SUCCESS: Project created with device '%s' %s." % (device.device_info.name, dev_id.version))
    sys.exit(0)
except SystemExit:
    raise
except Exception as e:
    detailed_error = traceback.format_exc()
    print("Error creating project '%s': %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error))
    print("SCRIPT_ERROR: Error creating project: %s" % e)
    sys.exit(1)
