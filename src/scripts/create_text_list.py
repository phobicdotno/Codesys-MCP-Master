import sys, scriptengine as script_engine, os, traceback

LIST_NAME = "{LIST_NAME}"
PARENT_PATH = "{PARENT_PATH}"

try:
    print("DEBUG: create_text_list script: Name='%s', Parent='%s', Project='%s'" % (
        LIST_NAME, PARENT_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not LIST_NAME:
        raise ValueError("Text list name empty.")

    if PARENT_PATH:
        parent = find_object_by_path_robust(primary_project, PARENT_PATH, "parent")
        if not parent:
            raise ValueError("Parent not found at path: %s" % PARENT_PATH)
    else:
        parent = primary_project

    if not hasattr(parent, 'create_textlist'):
        raise TypeError("Parent does not support create_textlist (not a text list container).")
    parent.create_textlist(LIST_NAME)
    primary_project.save()

    print("Text List: %s" % LIST_NAME)
    print("Parent: %s" % (PARENT_PATH or '<project root>'))
    print("SCRIPT_SUCCESS: Text list created. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error creating text list '%s' in %s: %s\n%s" % (
        LIST_NAME, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
