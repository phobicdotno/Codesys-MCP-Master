import sys, scriptengine as script_engine, os, traceback

EXPORT_PATH = r"{EXPORT_PATH}"
OBJECT_PATH = "{OBJECT_PATH}"
RECURSIVE = {RECURSIVE}

try:
    print("DEBUG: export_plcopen_xml script: path='%s', object='%s', recursive=%s, Project='%s'" % (
        EXPORT_PATH, OBJECT_PATH, RECURSIVE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not EXPORT_PATH:
        raise ValueError("Export path empty.")

    if OBJECT_PATH:
        target = find_object_by_path_robust(primary_project, OBJECT_PATH, "export root")
        if not target:
            raise ValueError("Object not found at path: %s" % OBJECT_PATH)
        objects = [target]
        print("DEBUG: Exporting subtree '%s'" % OBJECT_PATH)
    else:
        objects = list(primary_project.get_children(False))
        print("DEBUG: Exporting all %d top-level objects" % len(objects))

    # Keyword args: positional order drifts between SPs (a misplaced 'path'
    # silently switches export_xml into export-to-string mode). reporter=None
    # -> no reporting; non-exportable objects are skipped by the engine.
    # ALL arguments by keyword: SP21's runtime overload is reporter-first
    # (stub documents objects-first), so any positional arg can land in the
    # wrong slot depending on SP.
    try:
        primary_project.export_xml(objects=objects, reporter=None, path=EXPORT_PATH,
                                   recursive=RECURSIVE, export_folder_structure=True)
    except TypeError as sig_err:
        print("DEBUG: full-keyword call failed (%s); retrying stub positional order." % sig_err)
        primary_project.export_xml(objects, None, EXPORT_PATH, RECURSIVE, True)

    if not os.path.isfile(EXPORT_PATH):
        raise RuntimeError(
            "export_xml returned without error but no file exists at '%s'. "
            "The engine likely exported to a string (signature drift)." % EXPORT_PATH)
    size_note = "%s bytes" % os.path.getsize(EXPORT_PATH)

    print("Export Path: %s" % EXPORT_PATH)
    print("Objects: %d (recursive=%s)" % (len(objects), RECURSIVE))
    print("Size: %s" % size_note)
    print("SCRIPT_SUCCESS: PLCopenXML export written.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error exporting PLCopenXML for project %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
