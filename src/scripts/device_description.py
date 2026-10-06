import sys, scriptengine as script_engine, os, traceback

# Installs or removes a device description in the local device repository
# (script_engine.device_repository). This changes the CODESYS installation's
# repository, not a project. ACTION:
#   install_device  - import a .devdesc.xml / .xml / supported description file
#   install_vendor  - import a vendor description file
#   remove_device   - remove the device with TYPE/ID/VERSION
#   find_device     - check whether TYPE/ID/VERSION is installed (read-only)

ACTION = "{ACTION}"
FILE_PATH = r"{FILE_PATH}"
DEVICE_TYPE = {DEVICE_TYPE}
DEVICE_ID = "{DEVICE_ID}"
DEVICE_VERSION = "{DEVICE_VERSION}"
SOURCE_NAME = "{SOURCE_NAME}"

def _source(repo):
    sources = list(repo.sources)
    if not sources:
        raise RuntimeError("Device repository has no sources.")
    if SOURCE_NAME:
        for s in sources:
            if getattr(s, 'name', '') == SOURCE_NAME:
                return s
        raise ValueError("Repository source '%s' not found. Available: %s" % (SOURCE_NAME, ", ".join(getattr(s, 'name', '?') for s in sources)))
    return sources[0]

def _find(repo, dtype, did_str, version):
    """get_device by identification; some SPs (seen on SP22) miss a freshly
    imported device there, so fall back to scanning get_all_devices()."""
    did = repo.create_device_identification(dtype, did_str, version)
    dev = repo.get_device(did)
    if dev is not None:
        return did, dev
    try:
        for d in repo.get_all_devices():
            x = d.device_id
            if int(x.type) == int(dtype) and str(x.id) == did_str and str(x.version) == version:
                return x, d
    except Exception as e:
        print("DEBUG: get_all_devices scan failed: %s" % e)
    return did, None

def _describe(dev):
    di = dev.device_info
    return "%s | vendor %s | type %s id %s version %s" % (di.name, di.vendor, dev.device_id.type, dev.device_id.id, dev.device_id.version)

try:
    repo = script_engine.device_repository
    if ACTION in ('install_device', 'install_vendor'):
        if not os.path.isfile(FILE_PATH):
            raise ValueError("File not found: %s" % FILE_PATH)
        src = _source(repo)
        if ACTION == 'install_device':
            res = repo.import_device(FILE_PATH, src, True)
        else:
            res = repo.import_vendor_description(FILE_PATH, src)
        print("Source: %s" % getattr(src, 'name', '?'))
        print("Imported: %s" % FILE_PATH)
        # import_device returns the DeviceId of the imported description.
        if res is not None and hasattr(res, 'id') and hasattr(res, 'version'):
            _, dev = _find(repo, res.type, str(res.id), str(res.version))
            print("Device: %s" % (_describe(dev) if dev is not None else "type %s id %s version %s" % (res.type, res.id, res.version)))
        print("SCRIPT_SUCCESS: Description installed.")
        sys.exit(0)

    if ACTION in ('remove_device', 'find_device'):
        if not DEVICE_ID or not DEVICE_VERSION:
            raise ValueError("deviceType, deviceId and deviceVersion are required.")
        did, dev = _find(repo, DEVICE_TYPE, DEVICE_ID, DEVICE_VERSION)
        if ACTION == 'find_device':
            print("Installed: %s" % (dev is not None))
            if dev is not None:
                print("Device: %s" % _describe(dev))
            print("SCRIPT_SUCCESS: Lookup done.")
            sys.exit(0)
        if dev is None:
            raise ValueError("Device type %s id %s version %s is not installed." % (DEVICE_TYPE, DEVICE_ID, DEVICE_VERSION))
        desc = _describe(dev)
        repo.remove_device(did, _source(repo), True)
        if _find(repo, DEVICE_TYPE, DEVICE_ID, DEVICE_VERSION)[1] is not None:
            raise RuntimeError("Device still present after remove_device.")
        print("Removed: %s" % desc)
        print("SCRIPT_SUCCESS: Device description removed.")
        sys.exit(0)

    raise ValueError("Unknown action '%s'." % ACTION)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in device_description (%s): %s\n%s" % (ACTION, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
