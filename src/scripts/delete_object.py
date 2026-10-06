import sys, scriptengine as script_engine, os, traceback

OBJECT_PATH = "{OBJECT_PATH}"

try:
    print("DEBUG: delete_object script: ObjectPath='%s', Project='%s'" % (OBJECT_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not OBJECT_PATH: raise ValueError("Object path empty.")

    # Find the target object
    target_object = find_object_by_path_robust(primary_project, OBJECT_PATH, "target object")
    if not target_object:
        raise ValueError("Object not found at path: %s" % OBJECT_PATH)

    target_name = getattr(target_object, 'get_name', lambda: OBJECT_PATH)()
    target_type = type(target_object).__name__
    print("DEBUG: Found target object: %s (Type: %s)" % (target_name, target_type))

    # Delete the object
    if hasattr(target_object, 'remove'):
        print("DEBUG: Calling remove() on object '%s'" % target_name)
        target_object.remove()
        print("DEBUG: Object removed.")
    elif hasattr(target_object, 'delete'):
        print("DEBUG: Calling delete() on object '%s'" % target_name)
        target_object.delete()
        print("DEBUG: Object deleted.")
    else:
        raise TypeError("Object '%s' of type %s does not support remove() or delete()." % (target_name, target_type))

    try:
        print("DEBUG: Saving Project...")
        primary_project.save()
        print("DEBUG: Project saved successfully after object deletion.")
    except Exception as save_err:
        print("ERROR: Failed to save Project after deleting object: %s" % save_err)
        detailed_error = traceback.format_exc()
        error_message = "Error saving Project after deleting '%s': %s\n%s" % (target_name, save_err, detailed_error)
        print(error_message); print("SCRIPT_ERROR: %s" % error_message); sys.exit(1)

    print("Object Deleted: %s" % target_name)
    print("Object Type: %s" % target_type)
    print("Path: %s" % OBJECT_PATH)
    print("SCRIPT_SUCCESS: Object deleted successfully.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error deleting object '%s' in project '%s': %s\n%s" % (OBJECT_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message); print("SCRIPT_ERROR: %s" % error_message); sys.exit(1)
