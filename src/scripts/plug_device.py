import sys, scriptengine as script_engine, os, traceback

# Plugs a device into a slot (device.plug) or unplugs the device in a slot
# (device.unplug), then saves. Slots exist where the device description
# defines them (<Slot> on the connector); empty slots all show as '<Empty>',
# so plug addresses the slot by its parent and 1-based position.
# K-Bus modules and other free child lists are not slots: use add_device.
# ACTION: plug | unplug.

ACTION = "{ACTION}"
PARENT_PATH = "{PARENT_PATH}"   # plug: parent device holding the slots
SLOT_INDEX = {SLOT_INDEX}       # plug: 1-based slot position under the parent
DEVICE_PATH = "{DEVICE_PATH}"   # unplug: the plugged device
NEW_NAME = "{NEW_NAME}"
DEVICE_TYPE = {DEVICE_TYPE}
DEVICE_ID = "{DEVICE_ID}"
DEVICE_VERSION = "{DEVICE_VERSION}"
MODULE_ID = {MODULE_ID}

def _ident(dev):
    try:
        d = dev.get_device_identification()
        return "type %s id %s version %s" % (d.type, d.id, d.version)
    except Exception as e:
        return "<identification unavailable: %s>" % e

def _children(obj):
    return list(obj.get_children(False))

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if ACTION == 'plug':
        if not NEW_NAME or not DEVICE_ID or not DEVICE_VERSION:
            raise ValueError("plug needs name, deviceType, deviceId and deviceVersion.")
        parent = find_object_by_path_robust(primary_project, PARENT_PATH, "parent device")
        if not parent:
            raise ValueError("Parent device not found at path: %s" % PARENT_PATH)
        kids = _children(parent)
        if SLOT_INDEX < 1 or SLOT_INDEX > len(kids):
            raise ValueError("slotIndex %d out of range 1..%d under '%s'." % (SLOT_INDEX, len(kids), PARENT_PATH))
        slot = kids[SLOT_INDEX - 1]
        if not hasattr(slot, 'plug'):
            raise TypeError("Child %d of '%s' (%s) is not a device slot." % (SLOT_INDEX, PARENT_PATH, slot.get_name()))
        before = "%s (%s)" % (slot.get_name(), _ident(slot))
        slot.plug(NEW_NAME, DEVICE_TYPE, DEVICE_ID, DEVICE_VERSION, MODULE_ID)
        primary_project.save()
        now = _children(parent)[SLOT_INDEX - 1]
        print("Slot: %s #%d" % (PARENT_PATH, SLOT_INDEX))
        print("Before: %s" % before)
        print("After: %s (%s)" % (now.get_name(), _ident(now)))
    elif ACTION == 'unplug':
        dev = find_object_by_path_robust(primary_project, DEVICE_PATH, "plugged device")
        if not dev:
            raise ValueError("Device not found at path: %s" % DEVICE_PATH)
        if not hasattr(dev, 'unplug'):
            raise TypeError("Object '%s' does not support unplug." % DEVICE_PATH)
        before = "%s (%s)" % (dev.get_name(), _ident(dev))
        parent = dev.parent
        idx = [c.get_name() for c in _children(parent)].index(dev.get_name())
        dev.unplug()
        primary_project.save()
        now = _children(parent)[idx]
        print("Before: %s" % before)
        print("After: slot #%d is %s" % (idx + 1, now.get_name()))
    else:
        raise ValueError("Unknown action '%s'." % ACTION)
    print("SCRIPT_SUCCESS: Device %sged. Project saved." % ACTION)
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    msg = str(e)
    if 'not a slot device' in msg:
        msg += " (this device sits in a free child list, e.g. a K-Bus module: use add_device / delete_object instead)"
    error_message = "Error in %s (%s%s) in project %s: %s\n%s" % (ACTION, PARENT_PATH or DEVICE_PATH, (" #%d" % SLOT_INDEX) if ACTION == 'plug' else '', PROJECT_FILE_PATH, msg, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
