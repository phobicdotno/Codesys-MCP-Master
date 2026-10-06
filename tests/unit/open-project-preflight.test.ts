import { describe, it, expect } from 'vitest';
import { decideOpenProjectPreflight } from '../../src/preflight';
import { parseProfileName } from '../../src/detect';

describe('decideOpenProjectPreflight', () => {
  it('exact SP+patch match -> proceed with no message', () => {
    const decision = decideOpenProjectPreflight(
      {
        sp: 22,
        patch: 1,
        profileName: 'CODESYS V3.5 SP22 Patch 1',
        profileVersion: '3.5.22.10',
      },
      { sp: 22, patch: 1 },
      'C:\\Projects\\MyPLC.project'
    );
    expect(decision.action).toBe('proceed');
    expect(decision.message).toBeUndefined();
  });

  it('same SP, different patch -> proceed-with-warning, message references both profiles', () => {
    const decision = decideOpenProjectPreflight(
      {
        sp: 22,
        patch: 1,
        profileName: 'CODESYS V3.5 SP22 Patch 1',
        profileVersion: '3.5.22.10',
      },
      { sp: 22, patch: 5 },
      'C:\\Projects\\MyPLC.project'
    );
    expect(decision.action).toBe('proceed-with-warning');
    expect(decision.message).toBeDefined();
    // Project profile present
    expect(decision.message).toContain('CODESYS V3.5 SP22 Patch 1');
    expect(decision.message).toContain('3.5.22.10');
    // Server profile present
    expect(decision.message).toContain('CODESYS V3.5 SP22 Patch 5');
    expect(decision.message).toContain('3.5.22.50');
    // Tells the user CODESYS will pop its dialog
    expect(decision.message).toMatch(/patch-difference dialog/);
  });

  it('SP mismatch -> refuse, message contains routing hint with --for-project and the project path', () => {
    const projectPath = 'C:\\Projects\\Old\\LegacyPLC.project';
    const decision = decideOpenProjectPreflight(
      {
        sp: 22,
        patch: 1,
        profileName: 'CODESYS V3.5 SP22 Patch 1',
        profileVersion: '3.5.22.10',
      },
      { sp: 21, patch: 5 },
      projectPath
    );
    expect(decision.action).toBe('refuse');
    expect(decision.message).toBeDefined();
    expect(decision.message).toContain('Refused');
    // Mentions both profiles so the user can see what doesn't line up
    expect(decision.message).toContain('CODESYS V3.5 SP22 Patch 1');
    expect(decision.message).toContain('CODESYS V3.5 SP21 Patch 5');
    // Routing hint is present and includes the project path
    expect(decision.message).toContain('--print-config --for-project');
    expect(decision.message).toContain(projectPath);
    // Mentions SP21+ MCP entry switch as the recovery path
    expect(decision.message).toContain('SP22');
  });

  it('SP+patch both 0 (no patch) match -> proceed silently', () => {
    const decision = decideOpenProjectPreflight(
      {
        sp: 21,
        patch: 0,
        profileName: 'CODESYS V3.5 SP21',
        profileVersion: '3.5.21.0',
      },
      { sp: 21, patch: 0 },
      'C:\\Projects\\MyPLC.project'
    );
    expect(decision.action).toBe('proceed');
    expect(decision.message).toBeUndefined();
  });

  it('exact match where project profileVersion is identical to server-derived (3.5.22.10) -> proceed silently', () => {
    // Edge case: server is also SP22 Patch 1 (3.5.22.10). The pre-flight
    // shouldn't false-positive on the trivial "version string equality"
    // path -- it just has SP+patch numbers to work with.
    const decision = decideOpenProjectPreflight(
      {
        sp: 22,
        patch: 1,
        profileName: 'CODESYS V3.5 SP22 Patch 1',
        profileVersion: '3.5.22.10',
      },
      { sp: 22, patch: 1 },
      'D:\\work\\Project.project'
    );
    expect(decision.action).toBe('proceed');
    expect(decision.message).toBeUndefined();
  });
});

describe('parseProfileName', () => {
  it('parses "CODESYS V3.5 SP22 Patch 1" -> {sp:22, patch:1}', () => {
    expect(parseProfileName('CODESYS V3.5 SP22 Patch 1')).toEqual({ sp: 22, patch: 1 });
  });

  it('parses "CODESYS V3.5 SP21" (no patch) -> {sp:21, patch:0}', () => {
    expect(parseProfileName('CODESYS V3.5 SP21')).toEqual({ sp: 21, patch: 0 });
  });

  it('returns null for non-standard profile names', () => {
    expect(parseProfileName('Custom Profile XYZ')).toBeNull();
    expect(parseProfileName('')).toBeNull();
    expect(parseProfileName('CODESYS V3.5')).toBeNull();
  });

  it('tolerates leading/trailing whitespace', () => {
    expect(parseProfileName('  CODESYS V3.5 SP22 Patch 1  ')).toEqual({ sp: 22, patch: 1 });
  });
});
