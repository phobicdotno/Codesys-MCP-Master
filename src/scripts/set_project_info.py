import sys, scriptengine as script_engine, os, traceback

# Empty string = leave unchanged.
COMPANY = {COMPANY}
TITLE = {TITLE}
VERSION = {VERSION}
AUTHOR = {AUTHOR}
DESCRIPTION = {DESCRIPTION}

try:
    print("DEBUG: set_project_info script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    info = primary_project.get_project_info()
    changed = []
    for prop, val in (('company', COMPANY), ('title', TITLE), ('version', VERSION),
                      ('author', AUTHOR), ('description', DESCRIPTION)):
        if not val:
            continue
        setattr(info, prop, val)
        changed.append("%s='%s'" % (prop, val))
        print("DEBUG: set %s = %s" % (prop, val))

    if not changed:
        raise ValueError("Nothing to set: all fields empty.")

    primary_project.save()
    print("Changed: %s" % ", ".join(changed))
    print("SCRIPT_SUCCESS: Project info updated and saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error setting project info for %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
