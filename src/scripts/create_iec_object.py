import sys, scriptengine as script_engine, os, traceback

# Creates IEC objects the other create_* tools do not cover, then saves:
#   persistentvars - Persistent Vars object (create_persistentvars, IScriptIecLanguageObjectContainer3)
#   interface      - OOP interface (create_interface), optional base interfaces
#   action         - action of a POU (create_action), ST
# Optional declaration / implementation text is applied after creation.

KIND = "{KIND}"
PARENT_PATH = "{PARENT_PATH}"   # '' = active application
NAME = "{NAME}"
BASE_INTERFACES = "{BASE_INTERFACES}"
DECLARATION_CONTENT = """{DECLARATION_CONTENT}"""
IMPLEMENTATION_CONTENT = """{IMPLEMENTATION_CONTENT}"""
SET_DECLARATION = {SET_DECLARATION}
SET_IMPLEMENTATION = {SET_IMPLEMENTATION}

_METHOD = {'persistentvars': 'create_persistentvars', 'interface': 'create_interface',
           'action': 'create_action'}

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if KIND not in _METHOD:
        raise ValueError("kind must be one of: %s" % ", ".join(sorted(_METHOD)))
    if not NAME:
        raise ValueError("Name empty.")
    if PARENT_PATH:
        parent = find_object_by_path_robust(primary_project, PARENT_PATH, "parent")
        if not parent:
            raise ValueError("Parent not found at path: %s" % PARENT_PATH)
    else:
        if KIND == 'action':
            raise ValueError("parentPath (the POU) is required for kind=%s." % KIND)
        parent = primary_project.active_application
        if parent is None:
            raise RuntimeError("No active application.")
    meth = _METHOD[KIND]
    if not hasattr(parent, meth):
        raise TypeError("'%s' cannot hold a %s here: %s is not available on this object or CODESYS version." % (PARENT_PATH or 'active application', KIND, meth))

    if KIND == 'persistentvars':
        new_obj = parent.create_persistentvars(NAME)
    elif KIND == 'interface':
        new_obj = parent.create_interface(NAME, BASE_INTERFACES or None)
    else:
        new_obj = parent.create_action(NAME, None)
    if new_obj is None:
        raise RuntimeError("%s returned no object." % meth)

    # The text parts only exist once the object does; if applying the given
    # code fails, remove the half-made object again (nothing is saved).
    try:
        if SET_DECLARATION:
            if not getattr(new_obj, 'has_textual_declaration', False):
                raise TypeError("declarationCode given but the new %s has no textual declaration." % KIND)
            new_obj.textual_declaration.replace(DECLARATION_CONTENT)
        if SET_IMPLEMENTATION:
            if not getattr(new_obj, 'has_textual_implementation', False):
                raise TypeError("implementationCode given but the new %s has no textual implementation." % KIND)
            new_obj.textual_implementation.replace(IMPLEMENTATION_CONTENT)
    except Exception:
        try:
            new_obj.remove()
            print("DEBUG: removed the new %s again after the failure below." % KIND)
        except Exception as re:
            print("DEBUG: could not remove the new %s: %s" % (KIND, re))
        raise

    primary_project.save()
    print("Created %s: %s" % (KIND, new_obj.get_name()))
    print("Parent: %s" % (PARENT_PATH or 'active application'))
    print("SCRIPT_SUCCESS: %s created. Project saved." % KIND)
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error creating %s '%s' in project %s: %s\n%s" % (KIND, NAME, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
