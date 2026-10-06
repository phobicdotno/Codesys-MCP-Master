import sys, scriptengine as script_engine, os, traceback, json

# list_device_repository: the device descriptions installed in the local
# device repository (shared by every CODESYS install on the PC), filtered.
# Read-only. Use the type/id/version with add_device or update_device_type.
NAME_CONTAINS = {NAME_PY}
VENDOR_CONTAINS = {VENDOR_PY}
DEVICE_TYPE = {DEVICE_TYPE}   # None = any
LIMIT = {LIMIT}


def _s(v):
    try:
        return "" if v is None else str(v)
    except Exception:
        return ""


try:
    repo = script_engine.device_repository
    all_devs = list(repo.get_all_devices())
    rows = []
    matched = 0
    for d in all_devs:
        info = d.device_info
        did = d.device_id
        name = _s(getattr(info, "name", ""))
        vendor = _s(getattr(info, "vendor", ""))
        dtype = getattr(did, "type", None)
        if NAME_CONTAINS and NAME_CONTAINS.lower() not in name.lower():
            continue
        if VENDOR_CONTAINS and VENDOR_CONTAINS.lower() not in vendor.lower():
            continue
        if DEVICE_TYPE is not None and dtype != DEVICE_TYPE:
            continue
        matched += 1
        rows.append({
            "name": name,
            "vendor": vendor,
            "type": dtype,
            "id": _s(getattr(did, "id", "")),
            "version": _s(getattr(did, "version", "")),
            "description": _s(getattr(info, "description", ""))[:160],
        })
    # sort all matches first, then cut: the shown ones are the first in order
    rows.sort(key=lambda r: (r["vendor"].lower(), r["name"].lower(), r["version"]))
    rows = rows[:LIMIT]
    print("### DEVICES_START ###")
    print(json.dumps({"installed": len(all_devs), "matched": matched, "shown": len(rows), "devices": rows}, indent=1))
    print("### DEVICES_END ###")
    print("SCRIPT_SUCCESS: %d of %d device description(s) match." % (matched, len(all_devs)))
    sys.exit(0)
except Exception as e:
    msg = "Error listing the device repository: %s\n%s" % (e, traceback.format_exc())
    print(msg)
    print("SCRIPT_ERROR: %s" % msg)
    sys.exit(1)
