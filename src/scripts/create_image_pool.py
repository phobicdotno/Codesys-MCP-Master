import sys, scriptengine as script_engine, os, traceback

POOL_NAME = "{POOL_NAME}"
PARENT_PATH = "{PARENT_PATH}"

try:
    print("DEBUG: create_image_pool script: Name='%s', Parent='%s', Project='%s'" % (
        POOL_NAME, PARENT_PATH, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not POOL_NAME:
        raise ValueError("Image pool name empty.")

    if PARENT_PATH:
        parent = find_object_by_path_robust(primary_project, PARENT_PATH, "parent")
        if not parent:
            raise ValueError("Parent not found at path: %s" % PARENT_PATH)
    else:
        parent = primary_project

    if not hasattr(parent, 'create_imagepool'):
        raise TypeError("Parent does not support create_imagepool (not an image pool container).")
    parent.create_imagepool(POOL_NAME)
    primary_project.save()

    print("Image Pool: %s" % POOL_NAME)
    print("Parent: %s" % (PARENT_PATH or '<project root>'))
    print("SCRIPT_SUCCESS: Image pool created. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error creating image pool '%s' in %s: %s\n%s" % (
        POOL_NAME, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
