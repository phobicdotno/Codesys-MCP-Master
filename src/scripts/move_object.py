import sys, scriptengine as script_engine, os, traceback

OBJECT_PATH = "{OBJECT_PATH}"
NEW_PARENT_PATH = "{NEW_PARENT_PATH}"
NEW_INDEX = {NEW_INDEX}

try:
    print("DEBUG: move_object script: Object='%s', NewParent='%s', Index=%s, Project='%s'" % (
        OBJECT_PATH, NEW_PARENT_PATH, NEW_INDEX, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not OBJECT_PATH:
        raise ValueError("Object path empty.")

    target_object = find_object_by_path_robust(primary_project, OBJECT_PATH, "object to move")
    if not target_object:
        raise ValueError("Object not found at path: %s" % OBJECT_PATH)

    if NEW_PARENT_PATH:
        new_parent = find_object_by_path_robust(primary_project, NEW_PARENT_PATH, "new parent")
        if not new_parent:
            raise ValueError("New parent not found at path: %s" % NEW_PARENT_PATH)
        parent_name = getattr(new_parent, 'get_name', lambda: NEW_PARENT_PATH)()
    else:
        # Empty parent path = move to project top level.
        new_parent = primary_project
        parent_name = "<project root>"

    target_object.move(new_parent, NEW_INDEX)
    primary_project.save()
    print("DEBUG: move + save OK")

    print("Moved: %s" % OBJECT_PATH)
    print("New Parent: %s" % parent_name)
    print("Index: %s" % NEW_INDEX)
    print("SCRIPT_SUCCESS: Object moved. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error moving object '%s' in project %s: %s\n%s" % (
        OBJECT_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
