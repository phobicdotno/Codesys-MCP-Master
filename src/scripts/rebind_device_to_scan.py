# rebind_device_to_scan: re-bind the configured device to a scan result
# (typically the same physical PLC at a new gateway address after a
# reboot / re-cable / DHCP change).
#
# Match rule (in priority order):
#   1. exact device_name match (case-insensitive)
#   2. exact device_id match
#   3. caller-supplied address override (MATCH_ADDRESS)
#   4. if exactly one candidate, pick it
#   5. otherwise: refuse and dump the candidate list
#
# Once matched, call device.set_gateway_and_address(gateway, address) and
# save the project so the rebind persists across CODESYS restarts.

import sys, scriptengine as script_engine, os, traceback, json

PROJECT_FILE_PATH = r"{PROJECT_FILE_PATH}"
MATCH_NAME = r"{MATCH_NAME}"        # optional override
MATCH_DEVICE_ID = r"{MATCH_DEVICE_ID}"  # optional override
MATCH_ADDRESS = r"{MATCH_ADDRESS}"  # optional override -- skip scan match


def _find_gateway(target_device):
    global online
    target_guid = str(target_device.get_gateway())
    online = getattr(script_engine, 'online', None)
    if online is None:
        raise RuntimeError("scriptengine.online is not available.")
    if target_guid in ('', 'None', '00000000-0000-0000-0000-000000000000'):
        # Never connected (fresh project): bind through the local gateway.
        gw = local_gateway(online)
        print("DEBUG: device has no gateway yet; using '%s'" % gw.name)
        return gw
    for gw in online.gateways:
        try:
            if str(gw.guid) == target_guid:
                return gw
        except Exception:
            continue
    # The project may carry a gateway Guid from another machine/IDE profile
    # (e.g. a project copied from a colleague). When the caller forces an
    # address there is nothing to scan, so fall back to the local gateway
    # (first configured one, preferring a 'localhost' entry) instead of
    # refusing -- set_gateway_and_[ip_]address rebinds the device to it.
    gws = list(online.gateways)
    for gw in gws:
        try:
            print("DEBUG: configured gateway: name='%s' guid=%s" % (gw.name, gw.guid))
        except Exception:
            pass
    if MATCH_ADDRESS and gws:
        for gw in gws:
            try:
                if 'localhost' in str(gw.name).lower() or '127.0.0.1' in str(gw.name):
                    print("DEBUG: gateway %s not configured here; falling back to '%s'" % (target_guid, gw.name))
                    return gw
            except Exception:
                continue
        print("DEBUG: gateway %s not configured here; falling back to first gateway '%s'" % (target_guid, gws[0].name))
        return gws[0]
    raise RuntimeError("Device's gateway Guid %s is not in scriptengine.online.gateways." % target_guid)


def _describe(t):
    fields = ("device_name", "type_name", "vendor_name", "address", "parent_address")
    out = {}
    for f in fields:
        try:
            v = getattr(t, f, None)
            out[f] = "" if v is None else str(v)
        except Exception:
            out[f] = ""
    try:
        did = getattr(t, 'device_id', None)
        out["device_id"] = "" if did is None else str(did)
    except Exception:
        out["device_id"] = ""
    return out


def _pick_candidate(items, want_name, want_id, want_address):
    # 1. caller forced an address -- no scan match needed
    if want_address:
        return {"address": want_address, "device_name": "(forced)"}, "forced-address"
    # 2. by name
    if want_name:
        wn = want_name.lower()
        hits = [i for i in items if i.get('device_name', '').lower() == wn]
        if len(hits) == 1:
            return hits[0], "by-name"
        if len(hits) > 1:
            return None, "ambiguous-name"
    # 3. by device_id
    if want_id:
        hits = [i for i in items if i.get('device_id') == want_id]
        if len(hits) == 1:
            return hits[0], "by-device-id"
        if len(hits) > 1:
            return None, "ambiguous-device-id"
    # A name or device id that matched nothing must NOT fall through to "the
    # only candidate": that bound the project to whatever single PLC answered
    # the scan (seen 2026-10-05: a lab VM's Virtual Control
    # on the office network while the caller asked for the local soft PLC).
    if want_name or want_id:
        return None, "no-match-for-name-or-id"
    # No criteria at all: never "the only scan result" either. On an office
    # or vessel network that can be any PLC. The caller resolves the name
    # of the PLC the device was bound to before (see below), else refuses.
    return None, "no-criteria"


try:
    print("DEBUG: rebind_device_to_scan: Project='%s' name='%s' id='%s' addr='%s'" % (
        PROJECT_FILE_PATH, MATCH_NAME, MATCH_DEVICE_ID, MATCH_ADDRESS))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if 'apply_application_selection' in globals():
        apply_application_selection(primary_project)
    target = find_bindable_device(primary_project)
    target_name = target.get_name() if hasattr(target, 'get_name') else ''
    cached_address = str(target.get_address())
    print("DEBUG: target='%s' cached_address='%s'" % (target_name, cached_address))

    gw = _find_gateway(target)
    items = []
    if not MATCH_ADDRESS:
        print("DEBUG: scanning gateway '%s'..." % gw.name)
        items = [_describe(t) for t in (gw.perform_network_scan() or [])]

    # Without criteria, re-bind to the PLC this device was bound to before
    # (same name, new address after a reboot or DHCP change).
    match_name = MATCH_NAME
    if not (MATCH_NAME or MATCH_DEVICE_ID or MATCH_ADDRESS):
        prev = ''
        try:
            prev = str(getattr(target, 'scanned_device_name', '') or '')
        except Exception:
            prev = ''
        if prev:
            match_name = prev
            print("DEBUG: no criteria given; re-binding to the previously bound PLC '%s'" % prev)
    pick, reason = _pick_candidate(items, match_name, MATCH_DEVICE_ID, MATCH_ADDRESS)
    # A UDP scan is lossy: the local soft PLC was missing from one scan and
    # present in the next (2026-10-05). When a name or id was asked for and
    # not found, scan up to twice more (merging results) before giving up.
    extra = 0
    while pick is None and reason == "no-match-for-name-or-id" and not MATCH_ADDRESS and extra < 2:
        extra += 1
        print("DEBUG: '%s' not in scan; re-scan %d/2..." % (match_name or MATCH_DEVICE_ID, extra))
        try:
            more = [_describe(t) for t in (gw.perform_network_scan() or [])]
        except Exception as e:
            print("DEBUG: re-scan failed: %s" % e)
            more = []
        known = set((i.get('address'), i.get('device_name')) for i in items)
        items = items + [i for i in more if (i.get('address'), i.get('device_name')) not in known]
        pick, reason = _pick_candidate(items, match_name, MATCH_DEVICE_ID, MATCH_ADDRESS)

    if pick is None:
        print("### REBIND_RESULT_START ###")
        print(json.dumps({
            "rebound": False,
            "reason": reason,
            "cached_address": cached_address,
            "candidates": items,
            "candidate_count": len(items),
        }, sort_keys=True))
        print("### REBIND_RESULT_END ###")
        print("SCRIPT_SUCCESS: rebind_device_to_scan completed (no rebind).")
        sys.exit(0)

    new_address = pick.get('address') or ''
    if not new_address:
        raise RuntimeError("Selected candidate has empty address: %r" % pick)

    # Always call set_gateway_and_address, even when the address didn't
    # change. The IDE's Select-Device + OK flow does the same -- it
    # re-applies the binding to refresh the device's scanned_* properties
    # and re-establish a live session, which login()/download() depend
    # on. Skipping when address matches leaves the binding stale.
    print("DEBUG: rebinding (cached='%s' new='%s' reason=%s)" % (cached_address, new_address, reason))
    # IP-form addresses (e.g. '127.0.0.1:11740' for an SSH-tunnelled PLC) are
    # not valid node addresses for set_gateway_and_address ("Invalid address
    # format"). Use set_gateway_and_ip_address (ScriptDeviceObject, since
    # 3.5.8.0) which takes "ip[:port]" and connects the block driver directly
    # by IP -- no UDP discovery needed.
    import re as _re
    if _re.match(r'^\d{1,3}(\.\d{1,3}){3}(:\d+)?$', new_address):
        print("DEBUG: IP-form address detected -> set_gateway_and_ip_address")
        target.set_gateway_and_ip_address(gw, new_address)
    else:
        target.set_gateway_and_address(gw, new_address)
    try:
        primary_project.save()
    except Exception as e:
        print("WARN: project.save() raised: %s -- rebind applied in-memory; flush manually." % e)

    print("### REBIND_RESULT_START ###")
    print(json.dumps({
        "rebound": True,
        "reason": reason,
        "old_address": cached_address,
        "new_address": new_address,
        "matched_candidate": pick,
        "gateway_used": "%s (%s)" % (gw.name, gw.guid),
        "device_gateway_now": str(target.get_gateway()),
        "device_address_now": str(target.get_address()),
        "gateways_configured": ["%s (%s)" % (g.name, g.guid) for g in online.gateways],
    }, sort_keys=True))
    print("### REBIND_RESULT_END ###")
    print("SCRIPT_SUCCESS: rebind_device_to_scan completed.")
except Exception as e:
    print("SCRIPT_ERROR: %s: %s" % (type(e).__name__, e))
    traceback.print_exc()
    sys.exit(1)
