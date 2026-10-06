import sys, scriptengine as script_engine, os, traceback

class _InternalCompilerVersion(object):
    """SP18/SP19: their script API has no compiler-version calls, but CODESYS's
    own CompilerVersionManager (SystemInstances.CompilerVersionMgr) is
    reachable through the net_access helper. Same two methods as the API."""

    def __init__(self, project):
        self._mgr = net_system_instances().CompilerVersionMgr
        self._handle = project.handle

    def get_compilerversion(self):
        return self._mgr.CompilerVersionToUse(self._handle)

    def set_compilerversion_to_newest(self):
        versions = list(self._mgr.AvailableCompilerVersions)
        if not versions:
            raise RuntimeError("CODESYS lists no available compiler versions.")
        self._mgr.SetCompilerVersion(max(versions))


def _compiler_target(project):
    """The object that carries get_compilerversion / set_compilerversion_to_newest:
    project.project_settings (script engine 4.2, SP21+), else the project
    itself, else CODESYS's internal manager (SP18/SP19). None if all fail."""
    ps = getattr(project, 'project_settings', None)
    for obj in (ps, project):
        if obj is not None and hasattr(obj, 'get_compilerversion'):
            return obj
    try:
        return _InternalCompilerVersion(project)
    except Exception as internal_err:
        print("DEBUG: internal CompilerVersionMgr unavailable: %s" % internal_err)
    return None


try:
    print("DEBUG: set_compiler_version_to_newest script: Project='%s'" % PROJECT_FILE_PATH)
    primary_project = ensure_project_open(PROJECT_FILE_PATH)

    target = _compiler_target(primary_project)
    if target is None or not hasattr(target, 'set_compilerversion_to_newest'):
        raise TypeError("This CODESYS's script API has no compiler-version access "
                        "and the internal manager was not reachable. Set it in the IDE: Project > Project Settings > Compile options.")

    before = "unknown"
    try:
        before = str(target.get_compilerversion())
    except Exception:
        pass

    target.set_compilerversion_to_newest()
    primary_project.save()

    after = "unknown"
    try:
        after = str(target.get_compilerversion())
    except Exception:
        pass

    print("Compiler Version Before: %s" % before)
    print("Compiler Version After: %s" % after)
    print("SCRIPT_SUCCESS: Compiler version set to newest and project saved.")
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error setting compiler version for %s: %s\n%s" % (PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
