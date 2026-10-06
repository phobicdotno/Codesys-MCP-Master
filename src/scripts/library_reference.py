import sys, scriptengine as script_engine, os, traceback

# Library reference details and options (IScriptLibraryReference) of the
# active application's Library Manager. MODE:
#   get       - list one reference (or all when LIB_NAME is empty) with its
#               options and parameters
#   set       - change options and/or one parameter of LIB_NAME, then save
#   download  - libman.download_missing_libraries() (IScriptLibManObject3)

MODE = "{MODE}"
LIB_NAME = "{LIB_NAME}"
PARAM_NAME = "{PARAM_NAME}"
PARAM_VALUE = {PARAM_VALUE}
QUALIFIED_ONLY = {QUALIFIED_ONLY}
OPTIONAL = {OPTIONAL}
NAMESPACE = {NAMESPACE}
HIDE_WHEN_DEPENDENCY = {HIDE_WHEN_DEPENDENCY}
PUBLISH_SYMBOLS = {PUBLISH_SYMBOLS}

def _libman(proj):
    try:
        app = proj.active_application
    except Exception:
        app = None
    for scope in ([app] if app is not None else []) + [proj]:
        for c in scope.get_children(True):
            if getattr(c, 'is_libman', False):
                return c
    raise RuntimeError("No Library Manager found.")

def _params(ref):
    out = []
    try:
        prm = ref.parameters
        if prm is None:
            return out
        for k in prm:
            name = k if isinstance(k, basestring) else getattr(k, 'Key', getattr(k, 'name', str(k)))
            try:
                val = prm[name]
            except Exception:
                val = getattr(k, 'Value', '?')
            out.append((name, val))
    except Exception as e:
        out.append(('<error>', str(e)))
    return out

def _show(ref):
    print("Library: %s" % ref.name)
    print("  placeholder=%s managed=%s system=%s" % (ref.is_placeholder, ref.is_managed, ref.system_library))
    print("  namespace=%s qualified_only=%s optional=%s" % (ref.namespace, ref.qualified_only, ref.optional))
    print("  hide_when_referenced_as_dependency=%s publish_symbols_in_container=%s" % (ref.hide_when_referenced_as_depencency, ref.publish_symbols_in_container))
    ps = _params(ref)
    print("  parameters: %d" % len(ps))
    for n, v in ps:
        print("    %s = %s" % (n, v))

def _match(ref, name):
    n = (ref.name or '')
    return n == name or n.split(',')[0].strip() == name

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    lm = _libman(primary_project)

    if MODE == 'download':
        if not hasattr(lm, 'download_missing_libraries'):
            raise TypeError("download_missing_libraries is not available on this CODESYS version (needs IScriptLibManObject3).")
        res = lm.download_missing_libraries()
        print("Result: %s" % res)
        print("SCRIPT_SUCCESS: Missing libraries download requested.")
        sys.exit(0)

    refs = list(lm.references)
    if MODE == 'get':
        print("### LIBREF_START ###")
        shown = 0
        for r in refs:
            if not LIB_NAME or _match(r, LIB_NAME):
                _show(r)
                shown += 1
        print("### LIBREF_END ###")
        if LIB_NAME and shown == 0:
            raise ValueError("Library '%s' not referenced. Use list_project_libraries for names." % LIB_NAME)
        print("SCRIPT_SUCCESS: %d reference(s) listed." % shown)
        sys.exit(0)

    if MODE != 'set':
        raise ValueError("Unknown mode '%s'." % MODE)
    hits = [r for r in refs if _match(r, LIB_NAME)]
    if len(hits) != 1:
        raise ValueError("Library '%s' matched %d references; use the full name from list_project_libraries." % (LIB_NAME, len(hits)))
    ref = hits[0]
    changed = []
    if PARAM_NAME:
        if PARAM_VALUE is None:
            raise ValueError("paramValue is required with paramName.")
        names = [n for n, v in _params(ref)]
        if PARAM_NAME not in names:
            raise ValueError("Library '%s' has no parameter '%s'. Parameters: %s" % (ref.name, PARAM_NAME, ", ".join(names) or 'none'))
        ref.parameters[PARAM_NAME] = PARAM_VALUE
        changed.append("%s=%s" % (PARAM_NAME, PARAM_VALUE))
    for attr, val in (('qualified_only', QUALIFIED_ONLY), ('optional', OPTIONAL), ('namespace', NAMESPACE),
                      ('hide_when_referenced_as_depencency', HIDE_WHEN_DEPENDENCY),
                      ('publish_symbols_in_container', PUBLISH_SYMBOLS)):
        if val is not None:
            setattr(ref, attr, val)
            changed.append("%s=%s" % (attr, val))
    if not changed:
        raise ValueError("Nothing to set: all fields empty.")
    primary_project.save()
    print("### LIBREF_START ###")
    _show(ref)
    print("Changed: %s" % ", ".join(changed))
    print("### LIBREF_END ###")
    print("SCRIPT_SUCCESS: Library reference updated. Project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in library_reference (%s) for '%s' in project %s: %s\n%s" % (MODE, LIB_NAME, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
