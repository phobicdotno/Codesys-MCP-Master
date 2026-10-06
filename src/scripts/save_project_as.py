import sys, scriptengine as script_engine, os, traceback

NEW_PATH = r"{NEW_PATH}"
# '' = keep encryption as-is. A non-empty value sets a new password.
# The literal token __DISABLE__ disables encryption (maps to empty string in save_as).
PASSWORD = {PASSWORD}

try:
    print("DEBUG: save_project_as script: newPath='%s', Project='%s'" % (NEW_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not NEW_PATH:
        raise ValueError("New path empty.")

    if PASSWORD == "__DISABLE__":
        primary_project.save_as(NEW_PATH, "")
        print("Encryption: disabled")
    elif PASSWORD:
        primary_project.save_as(NEW_PATH, PASSWORD)
        print("Encryption: new password set")
    else:
        primary_project.save_as(NEW_PATH)
        print("Encryption: unchanged")

    print("New Path: %s" % NEW_PATH)
    print("SCRIPT_SUCCESS: Project saved as '%s'." % NEW_PATH)
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in save_as for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
