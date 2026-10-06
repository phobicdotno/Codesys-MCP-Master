import sys, scriptengine as script_engine, os, traceback

DESTINATION = r"{DESTINATION}"
OBJECT_PATH = "{OBJECT_PATH}"
RECURSIVE = {RECURSIVE}

try:
    print("DEBUG: export_native script: dest='%s', object='%s', recursive=%s, Project='%s'" % (
        DESTINATION, OBJECT_PATH, RECURSIVE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not DESTINATION:
        raise ValueError("Destination path empty.")

    if OBJECT_PATH:
        target = find_object_by_path_robust(primary_project, OBJECT_PATH, "export root")
        if not target:
            raise ValueError("Object not found at path: %s" % OBJECT_PATH)
        objects = [target]
        print("DEBUG: Exporting subtree '%s'" % OBJECT_PATH)
    else:
        objects = list(primary_project.get_children(False))
        print("DEBUG: Exporting all %d top-level objects" % len(objects))

    primary_project.export_native(objects, DESTINATION, RECURSIVE)

    if not os.path.isfile(DESTINATION):
        raise RuntimeError(
            "export_native returned without error but no file exists at '%s'." % DESTINATION)
    size_note = "%s bytes" % os.path.getsize(DESTINATION)

    print("Destination: %s" % DESTINATION)
    print("Objects: %d (recursive=%s)" % (len(objects), RECURSIVE))
    print("Size: %s" % size_note)
    print("SCRIPT_SUCCESS: Native export written.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error exporting native format for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
