import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { ScriptManager } from '../../src/script-manager';

/**
 * Script-preparation tests for the SP21-coverage phase 4 device & task
 * config tools. No CODESYS required.
 */
describe('E2E Script Preparation — device & task tools (SP21 coverage phase 4)', () => {
  const scriptsDir = path.join(__dirname, '..', '..', 'src', 'scripts');
  const mgr = new ScriptManager(scriptsDir);
  const P = { PROJECT_FILE_PATH: 'C:\\test.project' };
  const DEVICE_HELPERS = ['ensure_project_open', 'find_object_by_path', 'find_device_object'];

  it('list_device_parameters prepares with device helper and markers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'list_device_parameters', { ...P, DEVICE_PATH: '' }, DEVICE_HELPERS
    );
    expect(script).toContain('def find_device_object');
    expect(script).toContain('device_parameters');
    expect(script).toContain('### PARAMS_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('set_device_parameter prepares both get and set modes', () => {
    const get = mgr.prepareScriptWithHelpers(
      'set_device_parameter',
      { ...P, DEVICE_PATH: '', PARAM_NAME: '"Baudrate"', PARAM_ID: '', NEW_VALUE: '""', GET_ONLY: 'True' },
      DEVICE_HELPERS
    );
    expect(get).toContain('GET_ONLY = True');
    expect(get).toContain('SCRIPT_SUCCESS');
    const set = mgr.prepareScriptWithHelpers(
      'set_device_parameter',
      { ...P, DEVICE_PATH: '', PARAM_NAME: '""', PARAM_ID: '42', NEW_VALUE: '"230"', GET_ONLY: 'False' },
      DEVICE_HELPERS
    );
    expect(set).toContain('PARAM_ID = r"42"');
    expect(set).toContain('NEW_VALUE = "230"');
    expect(set).toContain('SCRIPT_SUCCESS');
  });

  it('io_mappings_csv prepares both directions', () => {
    const script = mgr.prepareScriptWithHelpers(
      'io_mappings_csv',
      { ...P, DEVICE_PATH: '', CSV_PATH: 'C:\\io.csv', DIRECTION: 'export' },
      DEVICE_HELPERS
    );
    expect(script).toContain('export_io_mappings_as_csv');
    expect(script).toContain('import_io_mappings_from_csv');
    expect(script).toContain('CSV_PATH = r"C:\\io.csv"');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('set_device_state prepares all four actions', () => {
    const script = mgr.prepareScriptWithHelpers(
      'set_device_state',
      { ...P, DEVICE_PATH: '', ACTION: 'simulation_on' },
      DEVICE_HELPERS
    );
    expect(script).toContain('ACTION = "simulation_on"');
    expect(script).toContain('set_simulation_mode');
    expect(script).toContain('.enable()');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('get_device_identification prepares with markers', () => {
    const script = mgr.prepareScriptWithHelpers(
      'get_device_identification', { ...P, DEVICE_PATH: '' }, DEVICE_HELPERS
    );
    expect(script).toContain('get_device_identification');
    expect(script).toContain('### DEVICE_ID_START ###');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('create_task prepares with duplicate guard', () => {
    const script = mgr.prepareScriptWithHelpers(
      'create_task', { ...P, TASK_NAME: 'FastTask' }, ['ensure_project_open']
    );
    expect(script).toContain('TASK_NAME = "FastTask"');
    expect(script).toContain('create_task');
    expect(script).toContain('is_task_configuration');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('configure_task prepares with selective properties', () => {
    const script = mgr.prepareScriptWithHelpers(
      'configure_task',
      { ...P, TASK_NAME: 'MainTask', KIND: 'cyclic', PRIORITY: '1', INTERVAL: 't#20ms', INTERVAL_UNIT: '', EVENT: '""' },
      ['ensure_project_open']
    );
    expect(script).toContain('KIND = "cyclic"');
    expect(script).toContain('KindOfTask');
    expect(script).toContain('SCRIPT_SUCCESS');
  });

  it('all phase-4 scripts are ASCII-only (IronPython 2.7 constraint)', () => {
    const names = [
      'find_device_object', 'list_device_parameters', 'set_device_parameter',
      'io_mappings_csv', 'set_device_state', 'get_device_identification',
      'create_task', 'configure_task',
    ];
    for (const name of names) {
      const content = mgr.loadTemplate(name);
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(content), `${name}.py must be ASCII-only`).toBe(true);
    }
  });
});
