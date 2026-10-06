import sys, scriptengine as script_engine, os, traceback

# Reads / writes an object's build properties (obj.build_properties,
# IScriptBuildProperties): exclude from build, link always, external,
# enable system call, compiler defines. A property whose *_is_valid flag is
# False does not apply to that object type and is reported as n/a; setting
# one is refused.
#
# Project-wide defines (project_settings.project_defines) are deliberately
# not offered: on SP21 P5 and SP22 P1 the setter changes the in-memory value
# and marks the project dirty, but the value is gone after save + reopen
# (verified live 2026-10-05); SP19 does not have the property at all.

OBJECT_PATH = "{OBJECT_PATH}"
APPLY = {APPLY}
EXCLUDE_FROM_BUILD = {EXCLUDE_FROM_BUILD}
LINK_ALWAYS = {LINK_ALWAYS}
EXTERNAL = {EXTERNAL}
ENABLE_SYSTEM_CALL = {ENABLE_SYSTEM_CALL}
COMPILER_DEFINES = {COMPILER_DEFINES}

_PROPS = [('exclude_from_build', 'EXCLUDE_FROM_BUILD'), ('link_always', 'LINK_ALWAYS'),
          ('external', 'EXTERNAL'), ('enable_system_call', 'ENABLE_SYSTEM_CALL'),
          ('compiler_defines', 'COMPILER_DEFINES')]

try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not OBJECT_PATH:
        raise ValueError("Object path empty.")
    obj = find_object_by_path_robust(primary_project, OBJECT_PATH, "target object")
    if not obj:
        raise ValueError("Object not found at path: %s" % OBJECT_PATH)
    bp = getattr(obj, 'build_properties', None)
    if bp is None:
        raise TypeError("Object '%s' has no build properties." % OBJECT_PATH)

    changed = []
    if APPLY:
        values = dict((attr, globals()[var]) for attr, var in _PROPS)
        wanted = [(a, v) for a, v in values.items() if v is not None]
        if not wanted:
            raise ValueError("Nothing to set: all fields empty.")
        for attr, val in wanted:
            if not getattr(bp, attr + '_is_valid'):
                raise ValueError("Build property '%s' does not apply to '%s'." % (attr, OBJECT_PATH))
        for attr, val in sorted(wanted):
            setattr(bp, attr, val)
            changed.append("%s=%s" % (attr, val))
        primary_project.save()

    print("### BUILD_PROPERTIES_START ###")
    print("Object: %s" % OBJECT_PATH)
    for attr, var in _PROPS:
        if getattr(bp, attr + '_is_valid'):
            print("%s: %s" % (attr, getattr(bp, attr)))
        else:
            print("%s: n/a" % attr)
    try:
        print("effectively_excluded_from_build: %s" % obj.effectively_excluded_from_build)
    except Exception:
        pass
    if changed:
        print("Changed: %s" % ", ".join(changed))
    print("### BUILD_PROPERTIES_END ###")
    print("SCRIPT_SUCCESS: %s" % ("Build properties set. Project saved." if APPLY else "Build properties read."))
    sys.exit(0)
except Exception as e:
    detailed_error = traceback.format_exc()
    error_message = "Error in build properties for '%s' in project %s: %s\n%s" % (OBJECT_PATH, PROJECT_FILE_PATH, e, detailed_error)
    print(error_message)
    print("SCRIPT_ERROR: %s" % error_message)
    sys.exit(1)
