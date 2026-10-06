import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager, rememberDeviceCredentials, rememberedDeviceUser } from '../../src/script-manager';

// A PLC with user management pops the Device User Logon dialog on login
// unless credentials were registered first. Every online script gets the
// registration helper, filled from credentials given earlier for that
// project or CODESYS_DEVICE_USER/PASSWORD (2026-10-05: read/write/reset/
// stop/disconnect hung once a device user existed).
const P = 'C:\\proj\\P.project';

describe('device credentials reach every online script', () => {
  const mgr = new ScriptManager(path.join(__dirname, '..', '..', 'src', 'scripts'));

  it('adds register_device_credentials with the env values when ensure_online_connection is used', () => {
    process.env.CODESYS_DEVICE_USER = 'envuser';
    process.env.CODESYS_DEVICE_PASSWORD = 'envpass';
    try {
      const s = mgr.prepareScriptWithHelpers(
        'read_variable',
        { PROJECT_FILE_PATH: 'C:\\other\\O.project', APPLICATION_PATH: 'None', VARIABLE_PATH: 'PLC_PRG.x' },
        ['ensure_project_open', 'select_application', 'ensure_online_connection']
      );
      expect(s).toContain('def register_device_credentials_if_set');
      expect(s).toContain('DEVICE_USER = "envuser"');
      expect(s).toContain('DEVICE_PASSWORD = "envpass"');
      const body = s.slice(s.indexOf('def ensure_online_connection'));
      expect(body).toContain("if 'register_device_credentials_if_set' in globals():");
    } finally {
      delete process.env.CODESYS_DEVICE_USER;
      delete process.env.CODESYS_DEVICE_PASSWORD;
    }
  });

  it('keeps explicit tool values', () => {
    const s = mgr.prepareScriptWithHelpers(
      'connect_to_device',
      { PROJECT_FILE_PATH: P, APPLICATION_PATH: 'None', LOGIN_WAIT_SECONDS: '5', DEVICE_USER: '"argu"', DEVICE_PASSWORD: '"argp"' },
      ['register_device_credentials', 'ensure_project_open', 'select_application', 'ensure_online_connection']
    );
    expect(s).toContain('DEVICE_USER = "argu"');
    expect((s.match(/def register_device_credentials_if_set/g) ?? []).length).toBe(1);
  });

  it('fills later online scripts of the same project with credentials a connect passed', () => {
    delete process.env.CODESYS_DEVICE_USER;
    delete process.env.CODESYS_DEVICE_PASSWORD;
    rememberDeviceCredentials('sessuser', 'sesspass', P);
    const s = mgr.prepareScriptWithHelpers(
      'read_variable',
      { PROJECT_FILE_PATH: P, APPLICATION_PATH: 'None', VARIABLE_PATH: 'PLC_PRG.x' },
      ['ensure_project_open', 'select_application', 'ensure_online_connection']
    );
    expect(s).toContain('DEVICE_USER = "sessuser"');
    expect(s).toContain('DEVICE_PASSWORD = "sesspass"');
  });

  it('never sends one project PLC credentials to another project, and wins over the env', () => {
    process.env.CODESYS_DEVICE_USER = 'envuser';
    try {
      rememberDeviceCredentials('userA', 'passA', 'C:\\a\\A.project');
      expect(rememberedDeviceUser('C:\\a\\A.project')).toBe('userA');
      expect(rememberedDeviceUser('c:/A/a.project')).toBe('userA');
      expect(rememberedDeviceUser('C:\\b\\B.project')).toBe('envuser');
    } finally {
      delete process.env.CODESYS_DEVICE_USER;
    }
    expect(rememberedDeviceUser('C:\\b\\B.project')).toBe('');
  });
});
