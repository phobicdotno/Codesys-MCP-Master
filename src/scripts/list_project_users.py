import sys, scriptengine as script_engine, os, traceback

try:
    print("DEBUG: list_project_users script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    um = primary_project.user_management
    if um is None:
        raise RuntimeError("Project user management is not available.")

    print("### USERS_START ###")
    users = list(um.users or [])
    for u in users:
        name = getattr(u, 'name', '?')
        full = ''
        active = '?'
        try:
            full = u.fullname or ''
        except Exception:
            pass
        try:
            active = str(u.active)
        except Exception:
            pass
        print("user\t%s\t%s\tactive=%s" % (name, full, active))
    groups = list(um.groups or [])
    for g in groups:
        print("group\t%s\t%s\t" % (getattr(g, 'name', '?'), getattr(g, 'description', '') or ''))
    print("### USERS_END ###")

    print("User Count: %d" % len(users))
    print("Group Count: %d" % len(groups))
    print("SCRIPT_SUCCESS: Listed project users and groups.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error listing project users for %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
