import sys, scriptengine as script_engine, os, traceback

ARCHIVE_PATH = r"{ARCHIVE_PATH}"
COMMENT = {COMMENT}

try:
    print("DEBUG: save_project_archive script: archive='%s', Project='%s'" % (ARCHIVE_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not ARCHIVE_PATH:
        raise ValueError("Archive path empty.")

    # Default additional categories, no extra files.
    if COMMENT:
        primary_project.save_archive(ARCHIVE_PATH, COMMENT)
    else:
        primary_project.save_archive(ARCHIVE_PATH)

    size_note = "unknown"
    try:
        size_note = "%s bytes" % os.path.getsize(ARCHIVE_PATH)
    except Exception:
        pass

    print("Archive: %s" % ARCHIVE_PATH)
    print("Size: %s" % size_note)
    print("SCRIPT_SUCCESS: Project archive saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error saving archive for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
