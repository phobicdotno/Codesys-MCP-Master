import sys, scriptengine as script_engine, os, traceback

OBJECT_PATH = "{OBJECT_PATH}"
EXCLUDE = {EXCLUDE}

try:
    print("DEBUG: set_exclude_from_build script: Object='%s', Exclude=%s, Project='%s'" % (
        OBJECT_PATH, EXCLUDE, PROJECT_FILE_PATH))
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not OBJECT_PATH:
        raise ValueError("Object path empty.")

    target_object = find_object_by_path_robust(primary_project, OBJECT_PATH, "target object")
    if not target_object:
        raise ValueError("Object not found at path: %s" % OBJECT_PATH)
    obj_name = getattr(target_object, 'get_name', lambda: OBJECT_PATH)()

    # SP21: the flag lives on ScriptBuildProperties (obj.build_properties);
    # newer SPs also expose a flat obj.exclude_from_build. Prefer the
    # build_properties path, fall back to the flat attribute.
    bp = getattr(target_object, 'build_properties', None)
    if bp is not None and hasattr(bp, 'exclude_from_build'):
        bp.exclude_from_build = EXCLUDE
        print("DEBUG: set via build_properties.exclude_from_build")
    elif hasattr(target_object, 'exclude_from_build'):
        target_object.exclude_from_build = EXCLUDE
        print("DEBUG: set via flat exclude_from_build")
    else:
        raise TypeError(
            "Object '%s' (type %s) has no build properties -- exclude_from_build "
            "is not applicable to it." % (obj_name, type(target_object).__name__))
    primary_project.save()

    effective = "unknown"
    try:
        effective = str(target_object.effectively_excluded_from_build)
    except Exception:
        pass

    print("Object: %s" % obj_name)
    print("Exclude From Build: %s" % EXCLUDE)
    print("Effectively Excluded: %s" % effective)
    print("SCRIPT_SUCCESS: exclude_from_build set. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error setting exclude_from_build for '%s' in project %s: %s\n%s" % (
        OBJECT_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
