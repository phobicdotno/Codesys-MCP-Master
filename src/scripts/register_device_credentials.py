# Pre-register device user credentials so login() / download() do NOT pop the
# modal "Device User Login" dialog in the IDE. Without this, the IDE blocks on
# the dialog forever in our headless / agent-driven case (IronPython cannot
# marshal to the WPF UI thread to dismiss it).
#
# API: ScriptOnline.set_default_credentials(username, password) -- added in
# CODESYS scripting API 3.5.3.0. Effect lasts until end of the current script
# execution. On older SPs the call raises and we silently fall back to the
# interactive dialog (current behaviour, no regression).
#
# Source values come from:
#   1. MCP tool args (deviceUser / devicePassword) -- per-call override
#   2. Environment vars (CODESYS_DEVICE_USER / CODESYS_DEVICE_PASSWORD) inherited
#      from the MCP server process (set via `claude mcp add -e`).
# Both empty = no registration, dialog pops as before.

DEVICE_USER = {DEVICE_USER}
DEVICE_PASSWORD = {DEVICE_PASSWORD}


def register_device_credentials_if_set():
    """Register default device credentials if both DEVICE_USER and
    DEVICE_PASSWORD were provided via tool args or env. Returns True on
    successful registration, False if not configured or unsupported on
    this SP. Never raises -- failure falls back to the interactive dialog."""
    if not DEVICE_USER or not DEVICE_PASSWORD:
        return False
    try:
        online = getattr(script_engine, 'online', None)
        if online is None:
            print("DEBUG: script_engine.online not available -- skipping device-credential pre-registration")
            return False
        setter = getattr(online, 'set_default_credentials', None)
        if setter is None:
            print("DEBUG: ScriptOnline.set_default_credentials missing on this SP -- skipping device-credential pre-registration (dialog will pop instead)")
            return False
        setter(DEVICE_USER, DEVICE_PASSWORD)
        print("DEBUG: pre-registered default device credentials for user '%s' (dialog will be suppressed)" % DEVICE_USER)
        return True
    except Exception as e:
        print("DEBUG: set_default_credentials failed: %s: %s -- falling back to interactive dialog" % (type(e).__name__, e))
        return False
