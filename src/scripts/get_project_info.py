import sys, scriptengine as script_engine, os, traceback

try:
    print("DEBUG: get_project_info script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    info = primary_project.get_project_info()

    print("### PROJECT_INFO_START ###")
    for prop in ('company', 'title', 'version', 'author', 'description'):
        try:
            val = getattr(info, prop)
            print("%s: %s" % (prop, val))
        except Exception as e:
            print("%s: <unavailable: %s>" % (prop, e))

    # Custom property dictionary (library properties etc.). The dictionary is
    # a .NET IDictionary in IronPython: .Keys property; fall back to keys().
    keys = []
    try:
        vals = info.values
        try:
            keys = list(vals.Keys)
        except Exception:
            keys = list(vals.keys())
    except Exception as e:
        print("DEBUG: could not enumerate values dictionary: %s" % e)
    for k in keys:
        try:
            print("values[%s]: %s" % (k, info.values[k]))
        except Exception as e:
            print("values[%s]: <unreadable: %s>" % (k, e))
    print("### PROJECT_INFO_END ###")
    print("SCRIPT_SUCCESS: Project info read.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error reading project info for %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
