# add_device: programmatically add a child device to the project tree under
# a specified parent device. Wraps ScriptDeviceObject.add(name, device_id).
#
# Inputs (template-substituted by Node):
#   {PROJECT_FILE_PATH}   -- absolute path to the .project file
#   {PARENT_PATH}         -- '/'-separated path to the parent device under
#                            which the new device should be added (e.g.
#                            'MainPLC' or 'MainPLC/Ethernet1'). Required.
#   {DEVICE_NAME}         -- name for the new device node in the project tree
#                            (e.g. 'OBS', 'GPIOs_A_B'). Becomes the auto-
#                            generated global variable name for IO mapping.
#                            Required.
#   {TARGET_NAME}         -- substring of the device repository entry's
#                            display name (e.g. 'Modbus TCP Server',
#                            'Ethernet'). Required.
#   {TARGET_VERSION}      -- optional exact version string (e.g. '4.5.0.0').
#                            Empty = highest-version match wins.
#
# Refuses to add if a child with the same DEVICE_NAME already exists under
# the parent (idempotent: returns success no-op message instead of duplicating).

import sys
import traceback

PROJECT_FILE_PATH = r'{PROJECT_FILE_PATH}'
PARENT_PATH = '{PARENT_PATH}'
DEVICE_NAME = '{DEVICE_NAME}'
TARGET_NAME = '{TARGET_NAME}'
TARGET_VERSION = '{TARGET_VERSION}'


def _resolve_device_by_name(name, version):
    """Look up the device repository for a device whose display name
    matches `name` (substring) and optionally an exact `version`. Returns
    the highest-version match (or the version match if specified), or None.
    Mirrors update_device_type's _resolve_device_by_name.
    """
    repo = None
    try:
        repo = script_engine.device_repository
    except Exception as e:
        print("DEBUG: script_engine.device_repository unavailable: %s" % e)
    if repo is None:
        try:
            repo = device_repository  # noqa: F821 -- builtin if injected
        except NameError:
            print("DEBUG: device_repository builtin not in scope either.")
            return None
    try:
        candidates = repo.get_all_devices(name, None)
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

    def _version_key(dev):
        try:
            v = dev.device_id.version
        except Exception:
            return (0,)
        try:
            return tuple(int(p) for p in str(v).split('.'))
        except Exception:
            return (str(v),)

    if version:
        for d in candidates:
            try:
                if str(d.device_id.version) == version:
                    return d
            except Exception:
                continue
        return None

    best = None
    best_key = None
    for d in candidates:
        try:
            d_name = d.device_info.name
        except Exception:
            d_name = '?'
        k = _version_key(d)
        print("DEBUG: candidate device: name='%s', version=%s" % (d_name, k))
        if best is None or k > best_key:
            best = d
            best_key = k
    # The newest description is not the right default: the device repository
    # is shared by every install, so SP18 also sees SP22's 3.5.22.10 Control
    # Win, and a project switched to it no longer logs in to a 3.5.18 PLC
    # ("Version mismatch: Selected=3.5.22.10, Online=3.5.18.50", 2026-10-05).
    # Prefer the newest version not newer than the running CODESYS.
    ide = _running_codesys_version()
    if ide and best is not None and _version_key(best)[:4] > ide:
        fitting = [d for d in candidates if _version_key(d)[:4] <= ide]
        if fitting:
            fitting.sort(key=_version_key)
            print("DEBUG: newest is %s; using %s, which fits CODESYS %s" % (
                _version_key(best), _version_key(fitting[-1]), '.'.join(str(x) for x in ide)))
            best = fitting[-1]
    return best


def _running_codesys_version():
    """(major, minor, sp, patch) of the running CODESYS, from its install
    directory name ('CODESYS 3.5.18.50'), or None."""
    try:
        import System, re
        exe = System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName
        m = re.search(r'CODESYS (\d+)\.(\d+)\.(\d+)\.(\d+)', exe)
        if m:
            return tuple(int(x) for x in m.groups())
    except Exception as e:
        print("DEBUG: could not read the CODESYS version: %s" % e)
    return None


def _is_device(obj):
    try:
        return bool(getattr(obj, 'is_device', False))
    except Exception:
        return False


def _find_device_by_path(project, path):
    """Walk '/'-separated `path` from project root, matching child names
    (case-insensitive on the final segment). Returns the ScriptObject or None.
    """
    segments = [s for s in path.replace('\\', '/').split('/') if s]
    if not segments:
        return None
    current = project
    for seg in segments:
        try:
            children = current.get_children(False)
        except Exception:
            children = []
        match = None
        for c in children:
            try:
                cn = c.get_name()
            except Exception:
                cn = ''
            if cn == seg or cn.lower() == seg.lower():
                match = c
                break
        if match is None:
            return None
        current = match
    return current


try:
    suppression_set = False
    try:
        from scriptengine import PromptHandling
        script_engine.system.prompt_handling = PromptHandling.NONE
        suppression_set = True
        print("DEBUG: system.prompt_handling = PromptHandling.NONE (suppress).")
    except Exception as e:
        print("DEBUG: could not set system.prompt_handling = PromptHandling.NONE: %s" % e)
    if not suppression_set:
        try:
            script_engine.system.prompt_handling = 0
            suppression_set = True
            print("DEBUG: system.prompt_handling = 0 (suppress, int fallback).")
        except Exception as e:
            print("DEBUG: int-literal prompt_handling = 0 also failed: %s" % e)

    print("DEBUG: add_device:")
    print("DEBUG:   Project        = %s" % PROJECT_FILE_PATH)
    print("DEBUG:   Parent path    = %s" % PARENT_PATH)
    print("DEBUG:   Device name    = %s" % DEVICE_NAME)
    print("DEBUG:   Target name    = %s" % TARGET_NAME)
    print("DEBUG:   Target version = %s" % (TARGET_VERSION or '<latest>'))

    if not PARENT_PATH:
        msg = "parentPath is required (e.g. 'MainPLC' or 'MainPLC/Ethernet1')."
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)
    if not DEVICE_NAME:
        msg = "deviceName is required (the name for the new device node in the tree)."
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)
    if not TARGET_NAME:
        msg = ("targetDeviceName is required (substring of the device "
               "repository entry's display name, e.g. 'Modbus TCP Server').")
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    project = script_engine.projects.primary
    if project is None:
        msg = "No primary project open -- ensure_project_open should have opened it."
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    parent = _find_device_by_path(project, PARENT_PATH)
    if parent is None:
        msg = ("Parent path '%s' not found in project. Use forward slashes and "
               "match the device names as shown in the navigator." % PARENT_PATH)
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)
    if not _is_device(parent):
        msg = ("Object at '%s' is not a device. add_device only attaches under "
               "device-typed ScriptObjects." % PARENT_PATH)
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    # Idempotent check: if a child with this name already exists, no-op.
    try:
        existing_children = parent.get_children(False)
    except Exception:
        existing_children = []
    for c in existing_children:
        try:
            cn = c.get_name()
        except Exception:
            cn = ''
        if cn == DEVICE_NAME:
            print("DEBUG: Child '%s' already exists under '%s'. No-op." % (DEVICE_NAME, PARENT_PATH))
            print("Device '%s' already exists under '%s'; not adding a duplicate."
                  % (DEVICE_NAME, PARENT_PATH))
            print("SCRIPT_SUCCESS: Device already present (idempotent no-op).")
            sys.exit(0)

    new_device_desc = _resolve_device_by_name(TARGET_NAME, TARGET_VERSION)
    if new_device_desc is None:
        if TARGET_VERSION:
            msg = ("No device matching name~='%s' AND version='%s' in the "
                   "device repository. Open Tools > Device Repository to "
                   "confirm the exact name + available versions."
                   % (TARGET_NAME, TARGET_VERSION))
        else:
            msg = ("No device matching name~='%s' in the device repository. "
                   "Open Tools > Device Repository to confirm the exact name."
                   % TARGET_NAME)
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    try:
        new_dev_id = new_device_desc.device_id
        new_dev_info = new_device_desc.device_info
        new_type_name = new_dev_info.name
    except Exception as e:
        msg = ("Resolved device for '%s' is missing device_id/device_info: %s"
               % (TARGET_NAME, e))
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    print("DEBUG: Adding child '%s' (type='%s', id=%s, version=%s) under '%s'"
          % (DEVICE_NAME, new_type_name, new_dev_id.id, new_dev_id.version, PARENT_PATH))

    try:
        new_child = parent.add(DEVICE_NAME, new_dev_id)
    except Exception as e:
        detailed = traceback.format_exc()
        msg = ("ScriptDeviceObject.add('%s', device_id) failed under parent "
               "'%s': %s\n%s\n"
               "Common causes: parent device doesn't allow children of this "
               "type (e.g. adding Modbus TCP Server under a non-Ethernet "
               "parent), or the device descriptor requires a library that "
               "isn't installed. Try the IDE manually: right-click parent > "
               "Add Device... and inspect what the dialog offers."
               % (DEVICE_NAME, PARENT_PATH, e, detailed))
        print("ERROR: %s" % msg)
        print("SCRIPT_ERROR: %s" % msg)
        sys.exit(1)

    try:
        project.save()
        print("DEBUG: Project saved.")
    except Exception as save_err:
        print("WARN: Project save after device add failed: %s" % save_err)

    print("Device '%s' (type='%s', version=%s) added under '%s'."
          % (DEVICE_NAME, new_type_name, new_dev_id.version, PARENT_PATH))
    print("SCRIPT_SUCCESS: Device added; project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = ("Error in add_device: %s\n%s" % (e, detailed_error))
    print(error_message)
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
