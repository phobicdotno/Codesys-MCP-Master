import sys, scriptengine as script_engine, os, traceback

# detect_project_version: which CODESYS profile saved a project whose file
# cannot be read offline (CODESYS's binary project format: many real projects and
# everything projects.create writes). Opens a THROWAWAY COPY (the server makes
# it in a temp folder) as a non-primary project without any updates, asks the
# object manager for the project's profile, closes it again. The project the
# user has open stays the primary one and is not touched. Verified 2026-10-06
# on SP21: an SP18, an SP19 and an SP22 project each report their own profile.
PROBE_PATH = r"{PROBE_PATH}"

try:
    print("DEBUG: detect_project_version: %s" % PROBE_PATH)
    project = None
    try:
        project = script_engine.projects.open(
            PROBE_PATH, primary=False,
            update_flags=script_engine.VersionUpdateFlags.NoUpdates, allow_readonly=True)
    except TypeError as sig_err:
        # Keep NoUpdates where the signature allows it: an update prompt
        # would block the call.
        print("DEBUG: open without allow_readonly (%s)" % sig_err)
        try:
            project = script_engine.projects.open(
                PROBE_PATH, primary=False,
                update_flags=script_engine.VersionUpdateFlags.NoUpdates)
        except TypeError as sig_err2:
            print("DEBUG: keyword open not available (%s); plain non-primary open" % sig_err2)
            project = script_engine.projects.open(PROBE_PATH, None, False)
    if project is None:
        raise RuntimeError("projects.open returned None for %s" % PROBE_PATH)
    try:
        ok, profile, name = net_system_instances().ObjectMgr.GetProfile(project.handle)
        if not ok or not name:
            raise RuntimeError("CODESYS did not report a profile for %s" % PROBE_PATH)
        print("### PROJECT_PROFILE: %s" % name)
    finally:
        try:
            project.close()
        except Exception as close_err:
            print("WARN: closing the probe copy failed: %s" % close_err)
    print("SCRIPT_SUCCESS: project profile read.")
    sys.exit(0)
except SystemExit:
    raise
except Exception as e:
    print("Error detecting the project version: %s\n%s" % (e, traceback.format_exc()))
    print("SCRIPT_ERROR: %s" % e)
    sys.exit(1)
