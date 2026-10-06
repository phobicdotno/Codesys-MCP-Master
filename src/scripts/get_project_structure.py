import sys, scriptengine as script_engine, os, traceback

def get_object_structure(obj, indent=0, max_depth=10):
    """Recursively traverse a CODESYS project object and build a text tree."""
    lines = []
    indent_str = "  " * indent

    if obj is None:
        lines.append("%s- ERROR: Null object received" % indent_str)
        return lines

    if indent > max_depth:
        lines.append("%s- (max depth reached)" % indent_str)
        return lines

    try:
        name = "Unnamed"
        obj_type = type(obj).__name__
        guid_str = ""
        folder_str = ""
        try:
            name = getattr(obj, 'get_name', lambda: "Unnamed")() or "Unnamed"
            if hasattr(obj, 'guid'):
                guid_str = " {%s}" % obj.guid
            if hasattr(obj, 'is_folder') and obj.is_folder:
                folder_str = " [Folder]"
        except Exception as name_err:
            print("WARN: Error getting name for object: %s" % name_err)
            name = "!Error!"

        lines.append("%s- %s (%s)%s%s" % (indent_str, name, obj_type, folder_str, guid_str))

        # Try to get children - catch errors for objects that don't support it
        children = []
        if hasattr(obj, 'get_children'):
            try:
                children = obj.get_children(False)
            except Exception as child_err:
                lines.append("%s  (error getting children: %s)" % (indent_str, child_err))

        for child in children:
            lines.extend(get_object_structure(child, indent + 1, max_depth))

    except Exception as e:
        lines.append("%s- Error processing node: %s" % (indent_str, e))
    return lines

# --- Main script ---
PROJECT_FILE_PATH = r"{PROJECT_FILE_PATH}"

try:
    project_path = PROJECT_FILE_PATH.strip('"\'')
    print("DEBUG: Getting structure for project: '%s'" % project_path)

    # Use the prepended ensure_project_open helper (same as all other scripts)
    primary_project = ensure_project_open(project_path)

    if primary_project is None:
        raise ValueError("Failed to open project: %s" % project_path)

    print("DEBUG: Project object type: %s" % type(primary_project).__name__)

    # Build structure tree
    print("DEBUG: Starting recursion for project structure (max_depth=15)")
    structure_list = get_object_structure(primary_project, max_depth=15)
    structure_output = "\n".join(structure_list)

    # Output with markers
    print("")
    print("--- PROJECT STRUCTURE START ---")
    print(structure_output)
    print("--- PROJECT STRUCTURE END ---")
    print("")
    print("SCRIPT_SUCCESS: Project structure retrieved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    print("Error getting structure for %s: %s" % (PROJECT_FILE_PATH, e))
    print(detailed_error)
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
