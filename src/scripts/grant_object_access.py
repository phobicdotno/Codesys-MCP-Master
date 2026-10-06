# grant_object_access: set the project-side Access Control permissions
# for a given group on a project object. Maps to the IDE's
# "Properties -> Access Control" dialog (Groups/Actions/Permissions
# matrix). Required for the Symbol Configuration object before a
# downloaded OPC UA server will advertise any UserIdentityToken
# policies -- if "Everyone" / your group has no View/Modify on the
# Symbol Configuration, the server has nothing to expose.
#
# API path:
#   primary_project.user_management
#     -> ScriptUserManagement (per ScriptUserManagement.pyi)
#   um.groups[name]               -> ScriptGroup
#   um.get_object_permission(obj, ObjectPermissionKind.View)
#     -> ScriptObjectPermission
#   perm.set_permission_state(group, PermissionState.Granted)

import sys, scriptengine as script_engine, os, traceback, json

PROJECT_FILE_PATH = r"{PROJECT_FILE_PATH}"
OBJECT_PATH = r"{OBJECT_PATH}"           # slash-separated, e.g. 'CodesysRpi/Plc Logic/Application/Symbols'
GROUP_NAME = r"{GROUP_NAME}"             # e.g. 'Everyone'
PERMISSIONS = r"{PERMISSIONS}"           # comma-separated subset of View,Modify,Remove,AddRemoveChildren
STATE = r"{STATE}"                       # Granted | Denied | Default


def _resolve_object_by_path(primary_project, slash_path):
    """Walk the project tree following a slash-separated path."""
    parts = [p for p in slash_path.replace('\\', '/').split('/') if p]
    if not parts:
        raise RuntimeError("OBJECT_PATH is empty.")
    # Use the global helper if loaded; otherwise inline a simple walker.
    # The shared helper accepts the short forms the other tools take
    # ('Application/PLC_PRG'). It was called by a name that does not exist
    # (find_object_by_path), so the strict walker below always ran and
    # 'Application/...' failed at the root.
    try:
        hit = find_object_by_path_robust(primary_project, slash_path, "target object")
        if hit is not None:
            return hit
    except NameError:
        pass

    current_children = list(primary_project.get_children(False))
    obj = None
    for i, part in enumerate(parts):
        match = None
        for c in current_children:
            try:
                if c.get_name() == part:
                    match = c
                    break
            except Exception:
                continue
        if match is None:
            raise RuntimeError(
                "OBJECT_PATH segment %r not found at depth %d (under %r)" % (
                    part, i, '/'.join(parts[:i]) or '<root>'))
        obj = match
        current_children = list(match.get_children(False))
    return obj


_KIND_ALIASES = {
    'view': 'View',
    'modify': 'Modify',
    'remove': 'Remove',
    'addremovechildren': 'AddRemoveChildren',
    'addremove': 'AddRemoveChildren',
    'children': 'AddRemoveChildren',
}


try:
    print("DEBUG: grant_object_access: Project='%s' Obj='%s' Group='%s' Perms='%s' State='%s'" %
          (PROJECT_FILE_PATH, OBJECT_PATH, GROUP_NAME, PERMISSIONS, STATE))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    um = None
    try:
        um = primary_project.user_management
    except Exception as e:
        raise RuntimeError("primary_project.user_management failed: %s" % e)
    if um is None:
        raise RuntimeError("primary_project.user_management is None -- user management may not be initialized for this project.")

    # Resolve group
    try:
        group = um.groups[GROUP_NAME]
    except Exception as e:
        try:
            avail = []
            for g in um.groups:
                try:
                    avail.append(str(g.name))
                except Exception:
                    pass
            raise RuntimeError("Group '%s' not found. Available: %r" % (GROUP_NAME, avail))
        except Exception:
            raise RuntimeError("Group '%s' not found: %s" % (GROUP_NAME, e))

    # Resolve target object
    target_obj = _resolve_object_by_path(primary_project, OBJECT_PATH)
    obj_name = getattr(target_obj, 'get_name', lambda: '?')()
    print("DEBUG: resolved target object: %s" % obj_name)

    # State enum
    state_lower = STATE.strip().lower()
    if state_lower in ('granted', 'grant', 'allow', 'allowed', 'true', '1'):
        state_enum = script_engine.PermissionState.Granted
    elif state_lower in ('denied', 'deny', 'block', 'blocked'):
        state_enum = script_engine.PermissionState.Denied
    elif state_lower in ('default', 'unset', ''):
        state_enum = script_engine.PermissionState.Default
    else:
        raise RuntimeError("STATE must be Granted/Denied/Default, got %r" % STATE)

    # Permission kinds
    raw_kinds = [k.strip() for k in PERMISSIONS.split(',') if k.strip()]
    if not raw_kinds:
        raw_kinds = ['View', 'Modify', 'Remove', 'AddRemoveChildren']
    kinds = []
    for k in raw_kinds:
        canonical = _KIND_ALIASES.get(k.lower(), k)
        try:
            kind_enum = getattr(script_engine.ObjectPermissionKind, canonical)
        except AttributeError:
            raise RuntimeError("Unknown permission kind %r (canonical %r). Valid: View, Modify, Remove, AddRemoveChildren" % (k, canonical))
        kinds.append((canonical, kind_enum))

    applied = []
    for canonical, kind_enum in kinds:
        try:
            perm = um.get_object_permission(target_obj, kind_enum)
        except Exception as e:
            raise RuntimeError("get_object_permission(%s) failed: %s" % (canonical, e))
        try:
            perm.set_permission_state(group, state_enum)
        except Exception as e:
            raise RuntimeError("set_permission_state(%s, %s) failed: %s" % (canonical, STATE, e))
        applied.append(canonical)
        print("DEBUG: %s.%s = %s for group %s" % (obj_name, canonical, STATE, GROUP_NAME))

    try:
        primary_project.save()
    except Exception as e:
        print("WARN: project.save() raised: %s -- changes applied in-memory; flush manually." % e)

    print("### GRANT_ACCESS_RESULT_START ###")
    print(json.dumps({
        "object": obj_name,
        "object_path": OBJECT_PATH,
        "group": GROUP_NAME,
        "state": STATE,
        "permissions_applied": applied,
    }, sort_keys=True))
    print("### GRANT_ACCESS_RESULT_END ###")

    print("SCRIPT_SUCCESS: grant_object_access completed.")
except Exception as e:
    detailed = traceback.format_exc()
    print("Error in grant_object_access: %s\n%s" % (e, detailed))
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
