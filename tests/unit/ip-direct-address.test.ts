import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

// ip_direct_address.py has no scriptengine import, so it runs under CPython
// as is. A fake gateway stands in for ScriptGateway.find_address_by_ip.
const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
const helper = path.join(scriptsDir, 'ip_direct_address.py');

function py(body: string): unknown {
  const code = [
    'import json, sys',
    'exec(open(sys.argv[1], encoding="utf-8").read())',
    'class GW:',
    '    def __init__(self, answer=None, error=None):',
    '        self.answer, self.error = answer, error',
    '    def find_address_by_ip(self, ip, port):',
    '        if self.error: raise SystemError(self.error)',
    '        return self.answer',
    body,
  ].join('\n');
  const r = spawnSync('python', ['-c', code, helper], { encoding: 'utf-8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}

describe('ip_direct_address helper', () => {
  it('parses ip[:port] and rejects anything else', () => {
    expect(py("print(json.dumps([parse_ip_form('192.0.2.10:11740'), parse_ip_form('192.0.2.10'), parse_ip_form('127.0.0.1:11747'), parse_ip_form('0301.3053'), parse_ip_form('300.0.0.1'), parse_ip_form('1.2.3.4:0')]))"))
      .toEqual([['192.0.2.10', 11740], ['192.0.2.10', 11740], ['127.0.0.1', 11747], null, null, null]);
  });

  it('encodes and decodes TCP-direct node addresses (values seen on SP19)', () => {
    expect(py("print(json.dumps([node_address_tail('127.0.0.1', 11747), decode_ip_direct('0003.7E76.1000.2DE3.7F00.0001'), decode_ip_direct('0301.1000.2DDC.7F00.0001'), decode_ip_direct('0301.3053')]))"))
      .toEqual(['1000.2DE3.7F00.0001', ['127.0.0.1', 11747], ['127.0.0.1', 11740], null]);
  });

  it('accepts the lookup only when the answer points at the requested ip:port', () => {
    const out = py([
      "ok = resolve_ip_direct(GW('0003.7E76.1000.2DDC.C000.020A'), '192.0.2.10', 11740)",
      // find_address_by_ip hands back the cached answer of an earlier lookup when nothing answers
      "stale = resolve_ip_direct(GW('0003.7E76.1000.2DE3.7F00.0001'), '192.0.2.10', 11740)",
      "err = resolve_ip_direct(GW(error='No device responded to the scan request in time.'), '192.0.2.10', 11740)",
      "print(json.dumps([ok, stale, err]))",
    ].join('\n')) as Array<[string | null, string | null]>;
    expect(out[0]).toEqual(['0003.7E76.1000.2DDC.C000.020A', null]);
    expect(out[1][0]).toBeNull();
    expect(out[1][1]).toContain('cached answer');
    expect(out[2][0]).toBeNull();
    expect(out[2][1]).toContain('No device responded');
  });
});

describe('IP rebind wiring', () => {
  const mgr = new ScriptManager();
  const P = { PROJECT_FILE_PATH: 'C:/x.project', APPLICATION_PATH: "''" };

  it('rebind resolves an IP form through the gateway instead of set_gateway_and_ip_address', () => {
    const src = fs.readFileSync(path.join(scriptsDir, 'rebind_device_to_scan.py'), 'utf-8');
    expect(src).toContain('resolve_ip_direct(gw, ip, port)');
    expect(src).toContain('"ip-lookup-failed"');
    expect(src).not.toMatch(/^\s*target\.set_gateway_and_ip_address\(/m);
    const script = mgr.prepareScriptWithHelpers('rebind_device_to_scan',
      { ...P, MATCH_NAME: '', MATCH_DEVICE_ID: '', MATCH_ADDRESS: '192.0.2.10:11740' },
      ['ensure_project_open', 'select_application', 'find_target_device', 'ip_direct_address']);
    expect(script.indexOf('def resolve_ip_direct(')).toBeGreaterThan(-1);
    expect(script.indexOf('def resolve_ip_direct(')).toBeLessThan(script.indexOf('ip_form = parse_ip_form(new_address)'));
    // the helper's regex quantifiers must survive interpolation
    expect(script).toContain('(\\d{1,3}(?:\\.\\d{1,3}){3})');
  });

  it('server passes the helper to rebind and both reachability checks', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'server.ts'), 'utf-8');
    for (const name of ['rebind_device_to_scan', 'verify_device_reachable']) {
      const re = new RegExp(`'${name}',[\\s\\S]{0,400}?\\[([^\\]]*)\\]`, 'g');
      const lists = [...server.matchAll(re)].map((m) => m[1]);
      expect(lists.length, name).toBeGreaterThan(0);
      for (const l of lists) expect(l, name).toContain("'ip_direct_address'");
    }
  });

  it('reachability uses a direct lookup for a TCP-direct binding', () => {
    const src = fs.readFileSync(path.join(scriptsDir, 'verify_device_reachable.py'), 'utf-8');
    expect(src).toContain('direct = decode_ip_direct(cached_address)');
    expect(src.indexOf('decode_ip_direct(cached_address)')).toBeLessThan(src.indexOf('perform_network_scan()'));
  });
});
