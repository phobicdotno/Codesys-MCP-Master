import { describe, it, expect } from 'vitest';
import { planDialogs, clearIdeDialogs, listDialogs, IdeDialog, DialogHelperRunner } from '../../src/ide-dialogs';

const scanBox: IdeDialog = { hwnd: 11, title: 'CODESYS', text: 'No device is responding to the scan request.', buttons: ['OK'] };
const lostBox: IdeDialog = { hwnd: 12, title: 'CODESYS', text: 'No connection to the device. Please rescan your network.', buttons: ['OK'] };
const pathBox: IdeDialog = {
  hwnd: 13, title: 'CODESYS',
  text: "No active path defined. Do you want to set it?\nClicking 'Yes' will start a network scan",
  buttons: ['Yes', 'No', 'Cancel'],
};
const onlineChange: IdeDialog = { hwnd: 14, title: 'CODESYS', text: 'The application has changed. Do you want to download?', buttons: ['Yes', 'No'] };

/** A fake helper: answers the listing with `dialogs`, records every press. */
function fakeRunner(dialogs: IdeDialog[], pressOk = true): { run: DialogHelperRunner; presses: string[] } {
  const presses: string[] = [];
  const run: DialogHelperRunner = async (args) => {
    const i = args.indexOf('-Hwnd');
    if (i === -1) return { code: 0, stdout: JSON.stringify({ dialogs }), stderr: '' };
    presses.push(`${args[i + 1]}:${args[args.indexOf('-Button') + 1]}`);
    return { code: pressOk ? 0 : 2, stdout: JSON.stringify({ ok: pressOk, message: 'x' }), stderr: '' };
  };
  return { run, presses };
}

describe('planDialogs', () => {
  it('answers only the report boxes, with the button that changes nothing', () => {
    const plan = planDialogs([scanBox, lostBox, pathBox, onlineChange]);
    expect(plan.answer.map((a) => `${a.dialog.hwnd}:${a.rule.button}`)).toEqual(['11:OK', '12:OK', '13:Cancel']);
    expect(plan.blocking).toEqual([onlineChange]);
  });

  it('does not answer a known text when its button is missing', () => {
    expect(planDialogs([{ ...pathBox, buttons: ['Yes', 'No'] }]).blocking).toHaveLength(1);
  });
});

describe('clearIdeDialogs', () => {
  it('presses the harmless buttons and lets the call go on', async () => {
    const { run, presses } = fakeRunner([scanBox, pathBox]);
    const r = await clearIdeDialogs(100, run);
    if (process.platform !== 'win32') return; // the helper only runs on Windows
    expect(r.block).toBeNull();
    expect(presses).toEqual(['11:OK', '13:Cancel']);
    expect(r.answered).toHaveLength(2);
  });

  it('blocks on a box that needs a decision and names its buttons', async () => {
    if (process.platform !== 'win32') return;
    const { run, presses } = fakeRunner([onlineChange]);
    const r = await clearIdeDialogs(100, run);
    expect(presses).toEqual([]);
    expect(r.block).toMatch(/ASK THE USER/);
    expect(r.block).toMatch(/buttons: Yes, No/);
  });

  it('blocks when pressing a harmless button failed', async () => {
    if (process.platform !== 'win32') return;
    const { run } = fakeRunner([scanBox], false);
    expect((await clearIdeDialogs(100, run)).block).toMatch(/No device is responding/);
  });

  it('never blocks without a PID or when the helper output is unreadable', async () => {
    expect(await clearIdeDialogs(null)).toEqual({ block: null, answered: [] });
    const broken: DialogHelperRunner = async () => ({ code: 2, stdout: 'garbage', stderr: 'boom' });
    expect(await clearIdeDialogs(100, broken)).toEqual({ block: null, answered: [] });
  });
});

describe('listDialogs', () => {
  it('reads a single button that PowerShell serialised as a string', async () => {
    const run: DialogHelperRunner = async () => ({
      code: 0, stdout: '{"dialogs":[{"hwnd":5,"title":"CODESYS","text":"t","buttons":"OK"}]}', stderr: '',
    });
    expect(await listDialogs(1, run)).toEqual([{ hwnd: 5, title: 'CODESYS', text: 't', buttons: ['OK'] }]);
  });
});
