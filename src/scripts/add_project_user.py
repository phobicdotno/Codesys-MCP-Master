import sys, scriptengine as script_engine, os, traceback

USER_NAME = "{USER_NAME}"
FULL_NAME = {FULL_NAME}
PASSWORD = {PASSWORD}
ADMIN_USER = {ADMIN_USER}
ADMIN_PASSWORD = {ADMIN_PASSWORD}

try:
    print("DEBUG: add_project_user script: User='%s', Project='%s'" % (USER_NAME, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not USER_NAME:
        raise ValueError("User name empty.")

    um = primary_project.user_management
    if um is None:
        raise RuntimeError("Project user management is not available.")

    # Modifying users requires a logged-on user with the Modify permission.
    # Default CODESYS projects have user 'Owner' with an empty password.
    if not getattr(um, 'logged_on_user', None):
        um.login(ADMIN_USER if ADMIN_USER else "Owner", ADMIN_PASSWORD)
        print("DEBUG: logged in to project user management as '%s'." % (ADMIN_USER or "Owner"))

    # Idempotent: reuse an existing user (e.g. left over from a previous
    # partially-failed run) instead of failing on a duplicate name.
    user = None
    try:
        user = um.users[USER_NAME]
        print("DEBUG: user '%s' already exists; updating." % USER_NAME)
    except Exception:
        pass
    created = user is None
    if created:
        user = um.users.create(USER_NAME)

    if FULL_NAME:
        user.fullname = FULL_NAME

    password_set = False
    password_note = "not requested"
    if PASSWORD:
        # SP21 removed IScriptUser.change_password ('no longer supported').
        # Probe the known shapes; degrade loudly if none works.
        for attempt in ('change_password', 'set_password', 'reset_password'):
            fn = getattr(user, attempt, None)
            if fn is None:
                continue
            try:
                if attempt == 'change_password':
                    fn("", PASSWORD)
                else:
                    fn(PASSWORD)
                password_set = True
                password_note = "set via %s" % attempt
                break
            except Exception as e:
                print("DEBUG: %s failed: %s" % (attempt, e))
        if not password_set:
            password_note = ("FAILED -- no working password API on this SP; "
                            "set it in the IDE (Project > Project Settings > Users and Groups)")

    primary_project.save()

    print("User: %s (%s)" % (USER_NAME, "created" if created else "updated"))
    print("Full Name: %s" % (FULL_NAME or '<none>'))
    print("Password: %s" % password_note)
    if PASSWORD and not password_set:
        print("WARNING: user saved WITHOUT the requested password.")
    print("SCRIPT_SUCCESS: Project user %s. Project saved." % ("created" if created else "updated"))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error creating project user '%s' in %s: %s\n%s" % (
        USER_NAME, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
