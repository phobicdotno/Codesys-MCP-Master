# ip_direct_address: bind a device to a PLC by IP the way the IDE does when
# you type an IP in Communication Settings and press Enter.
#
# The IDE resolves the IP through the gateway with a direct (unicast TCP)
# lookup and binds the device to the node address the PLC answers with,
# e.g. '0003.7E76.1000.2DE3.7F00.0001' for 127.0.0.1:11747:
#   <gateway route prefix> . 1000 . <port hex> . <ip hex hi> . <ip hex lo>
# The script API for that lookup is ScriptGateway.find_address_by_ip(ip, port)
# (ScriptEngine3, present on SP19 and later).
#
# Why not set_gateway_and_ip_address: it only switches the device to
# TrackingMode 'IPAddressTcp' and stores the IP. It leaves device_address
# untouched (SP19 keeps the OLD node address there, SP21/SP22 return ''),
# so get_address() keeps reporting the previous binding. The route prefix
# of a node address belongs to one gateway session: a node address saved
# while another gateway route was active (an old tunnel, before a VPN
# change) gives "No connection to the device. Please rescan your network."
# at login, exactly as a stale binding did in the field (SP19, 2026-10).
#
# Measured on SP19 Patch 2 (3.5.19.20), 2026-10-27:
#   - find_address_by_ip raises SystemError "No device responded to the scan
#     request in time." when nothing answers, UNLESS an earlier lookup in the
#     same CODESYS process succeeded: then it silently returns that earlier
#     address for any IP. So the returned address is only trusted when its
#     tail encodes the IP and port that were asked for.
#   - set_gateway_and_address(gw, resolved) sets TrackingMode 'Dummy' (fixed
#     address) and the device connects through it.

import re as _ipd_re

_IPD_IP_FORM = _ipd_re.compile(r'^\s*(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\s*$')
_IPD_TAIL = _ipd_re.compile(r'(?:^|\.)1000\.([0-9A-Fa-f]{4})\.([0-9A-Fa-f]{4})\.([0-9A-Fa-f]{4})$')


def parse_ip_form(text, default_port=11740):
    """'ip[:port]' -> (ip, port), or None when text is not an IP form."""
    m = _IPD_IP_FORM.match(text or '')
    if not m:
        return None
    parts = [int(x) for x in m.group(1).split('.')]
    if any(p > 255 for p in parts):
        return None
    port = int(m.group(2)) if m.group(2) else default_port
    if port < 1 or port > 65535:
        return None
    return (m.group(1), port)


def node_address_tail(ip, port):
    """The tail of a TCP-direct node address for ip:port, e.g. '1000.2DE3.7F00.0001'."""
    a, b, c, d = [int(x) for x in ip.split('.')]
    return '1000.%04X.%02X%02X.%02X%02X' % (port, a, b, c, d)


def decode_ip_direct(address):
    """A TCP-direct node address -> ('ip', port), or None for any other address."""
    m = _IPD_TAIL.search(str(address or '').strip())
    if not m:
        return None
    port = int(m.group(1), 16)
    hi = int(m.group(2), 16)
    lo = int(m.group(3), 16)
    ip = '%d.%d.%d.%d' % (hi >> 8, hi & 0xFF, lo >> 8, lo & 0xFF)
    return (ip, port)


def address_matches_ip(address, ip, port):
    """True when the node address really points at ip:port (guards against
    find_address_by_ip handing back the cached result of an earlier lookup)."""
    return str(address or '').strip().upper().endswith(node_address_tail(ip, port).upper())


def resolve_ip_direct(gw, ip, port):
    """Direct lookup of ip:port through gateway gw.
    Returns (node_address, None) on success or (None, reason) on failure."""
    try:
        addr = gw.find_address_by_ip(ip, port)
    except Exception as e:
        return None, "%s: %s" % (type(e).__name__, e)
    addr = str(addr or '').strip()
    if not addr:
        return None, "find_address_by_ip returned an empty address"
    if not address_matches_ip(addr, ip, port):
        return None, ("gateway returned '%s', which is not %s:%d (the cached answer of an "
                      "earlier lookup: nothing answered at %s:%d)" % (addr, ip, port, ip, port))
    return addr, None
