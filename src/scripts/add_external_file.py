import sys, scriptengine as script_engine, os, traceback

FILE_PATH = r"{FILE_PATH}"
OBJECT_NAME = "{OBJECT_NAME}"
PARENT_PATH = "{PARENT_PATH}"
REFERENCE_MODE = "{REFERENCE_MODE}"
AUTO_UPDATE_MODE = "{AUTO_UPDATE_MODE}"

try:
    print("DEBUG: add_external_file script: File='%s', Name='%s', Parent='%s', Ref='%s', Update='%s', Project='%s'" % (
        FILE_PATH, OBJECT_NAME, PARENT_PATH, REFERENCE_MODE, AUTO_UPDATE_MODE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not FILE_PATH or not os.path.isfile(FILE_PATH):
        raise ValueError("File does not exist: %s" % FILE_PATH)

    if PARENT_PATH:
        parent = find_object_by_path_robust(primary_project, PARENT_PATH, "parent")
        if not parent:
            raise ValueError("Parent not found at path: %s" % PARENT_PATH)
    else:
        parent = primary_project

    if not hasattr(parent, 'create_external_file_object'):
        raise TypeError("Parent does not support create_external_file_object.")

    ref_enum = getattr(script_engine, 'ReferenceMode', None)
    upd_enum = getattr(script_engine, 'AutoUpdateMode', None)
    if ref_enum is None or upd_enum is None:
        raise TypeError("ReferenceMode/AutoUpdateMode enums not available on this SP.")
    ref_map = {'link': 'Link', 'link_and_embed': 'LinkAndEmbed', 'embed': 'Embed'}
    upd_map = {'always': 'Always', 'prompt': 'Prompt', 'never': 'Never'}
    if REFERENCE_MODE.lower() not in ref_map:
        raise ValueError("Invalid referenceMode '%s'." % REFERENCE_MODE)
    if AUTO_UPDATE_MODE.lower() not in upd_map:
        raise ValueError("Invalid autoUpdateMode '%s'." % AUTO_UPDATE_MODE)

    name = OBJECT_NAME if OBJECT_NAME else None
    parent.create_external_file_object(
        FILE_PATH, name,
        getattr(ref_enum, ref_map[REFERENCE_MODE.lower()]),
        getattr(upd_enum, upd_map[AUTO_UPDATE_MODE.lower()]))
    primary_project.save()

    print("File: %s" % FILE_PATH)
    print("Object Name: %s" % (OBJECT_NAME or os.path.basename(FILE_PATH)))
    print("Reference Mode: %s" % REFERENCE_MODE)
    print("SCRIPT_SUCCESS: External file object created. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error adding external file '%s' to %s: %s\n%s" % (
        FILE_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
