import sys, scriptengine as script_engine, os, traceback

SAVE_FIRST = {SAVE_FIRST}

try:
    print("DEBUG: close_project script: saveFirst=%s, Project='%s'" % (SAVE_FIRST, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    dirty = False
    try:
        dirty = bool(primary_project.dirty)
    except Exception:
        pass

    if SAVE_FIRST and dirty:
        primary_project.save()
        print("DEBUG: Unsaved changes saved before close.")
    elif dirty:
        print("DEBUG: Project has unsaved changes -- closing DISCARDS them (saveFirst=False).")

    primary_project.close()
    print("Was Dirty: %s" % dirty)
    print("Saved Before Close: %s" % (SAVE_FIRST and dirty))
    print("SCRIPT_SUCCESS: Project closed.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error closing project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
