# --- Access to CODESYS's own .NET assemblies (helper) ---
# SP21/SP22 let a script clr.AddReference() a CODESYS assembly and import
# from _3S.*. SP18 refuses that: "Access to module ...\systeminstances.dll not
# permitted" (seen 2026-10-05). The assemblies are loaded anyway, and plain
# .NET reflection on them is allowed, so fall back to that.
import System


def net_assembly(name):
    """The loaded assembly `name` (e.g. 'SystemInstances'), referenced for
    imports where the script engine allows it. Returns the Assembly object."""
    asm = None
    for a in System.AppDomain.CurrentDomain.GetAssemblies():
        if a.GetName().Name == name:
            asm = a
            break
    if asm is None:
        try:
            asm = System.Reflection.Assembly.Load(name)
        except Exception as load_err:
            print("DEBUG: Assembly.Load(%s) failed: %s" % (name, load_err))
    try:
        import clr
        clr.AddReference(asm if asm is not None else name)
    except Exception as ref_err:
        print("DEBUG: clr.AddReference(%s) not allowed here: %s" % (name, ref_err))
    return asm


class _StaticProxy(object):
    """Static properties of a .NET type, read by reflection."""

    def __init__(self, net_type):
        self._t = net_type

    def __getattr__(self, attr):
        prop = self._t.GetProperty(attr)
        if prop is None:
            raise AttributeError("%s has no static property %s" % (self._t.FullName, attr))
        return prop.GetValue(None, None)


def net_system_instances():
    """_3S.CoDeSys.Core.SystemInstances (ObjectMgr, OnlineMgr, ...): imported
    where allowed, else a reflection proxy with the same attributes."""
    asm = net_assembly('SystemInstances')
    for extra in ('Objects', 'ObjectsWin'):
        net_assembly(extra)
    try:
        from _3S.CoDeSys.Core import SystemInstances
        return SystemInstances
    except ImportError as imp_err:
        print("DEBUG: import of _3S.CoDeSys.Core not allowed (%s); using reflection." % imp_err)
    if asm is None:
        raise RuntimeError("Assembly SystemInstances is not loaded in this CODESYS.")
    t = asm.GetType('_3S.CoDeSys.Core.SystemInstances')
    if t is None:
        raise RuntimeError("Type _3S.CoDeSys.Core.SystemInstances not found.")
    return _StaticProxy(t)
# --- End of .NET access helper ---
