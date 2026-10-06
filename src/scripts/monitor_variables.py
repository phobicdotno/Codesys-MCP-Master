import sys, scriptengine as script_engine, os, traceback, json, time

# monitor_variables: sample variables of the running application over a
# time window and summarise each one (first, last, min, max, number of
# changes), optionally with the raw samples. Reads all expressions in one
# read_values call per sample; waits with system.delay so CODESYS keeps
# processing messages between samples.
EXPRESSIONS = {EXPRESSIONS_PY}
DURATION_MS = {DURATION_MS}
INTERVAL_MS = {INTERVAL_MS}
INCLUDE_SAMPLES = {INCLUDE_SAMPLES}
MAX_SAMPLES = 2000


def _num(v):
    s = str(v).strip()
    if s.upper() in ("TRUE", "FALSE"):
        return 1.0 if s.upper() == "TRUE" else 0.0
    try:
        return float(s.split("#")[-1])
    except Exception:
        return None


try:
    primary_project = ensure_project_open(PROJECT_FILE_PATH)
    if not EXPRESSIONS:
        raise ValueError("Expressions list empty.")
    online_app, target_app = ensure_online_connection(primary_project)
    ensure_logged_in(online_app)

    series = dict((e, []) for e in EXPRESSIONS)
    t0 = time.time()
    n = 0
    while n < MAX_SAMPLES:
        t = time.time() - t0
        try:
            values = list(online_app.read_values(EXPRESSIONS))
        except Exception:
            values = []
            for e in EXPRESSIONS:
                try:
                    values.append(online_app.read_value(e))
                except Exception as ex:
                    values.append("<read failed: %s>" % ex)
        for i, e in enumerate(EXPRESSIONS):
            series[e].append((round(t * 1000.0), str(values[i]) if i < len(values) else None))
        n += 1
        if (time.time() - t0) * 1000.0 + INTERVAL_MS > DURATION_MS:
            break
        script_engine.system.delay(INTERVAL_MS)

    summary = []
    for e in EXPRESSIONS:
        s = series[e]
        vals = [v for (_, v) in s]
        changes = sum(1 for i in range(1, len(vals)) if vals[i] != vals[i - 1])
        nums = [x for x in (_num(v) for v in vals) if x is not None]
        entry = {
            "expression": e,
            "samples": len(vals),
            "first": vals[0] if vals else None,
            "last": vals[-1] if vals else None,
            "changes": changes,
        }
        if nums and len(nums) == len(vals):
            entry["min"] = min(nums)
            entry["max"] = max(nums)
        if INCLUDE_SAMPLES:
            entry["series_ms_value"] = s
        summary.append(entry)

    print("### MONITOR_START ###")
    print(json.dumps({
        "duration_ms": round((time.time() - t0) * 1000.0),
        "interval_ms": INTERVAL_MS,
        "samples": n,
        "variables": summary,
    }, indent=1))
    print("### MONITOR_END ###")
    print("SCRIPT_SUCCESS: Monitored %d variable(s), %d sample(s)." % (len(EXPRESSIONS), n))
    sys.exit(0)
except Exception as e:
    msg = "Error monitoring variables in %s: %s\n%s" % (PROJECT_FILE_PATH, e, traceback.format_exc())
    print(msg)
    print("SCRIPT_ERROR: %s" % msg)
    sys.exit(1)
