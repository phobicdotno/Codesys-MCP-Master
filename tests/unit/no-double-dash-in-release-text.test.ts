import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The classifier evidence lines end up in release commit messages and in the
// auto-appended Changelog entry of vessel repos. House style there forbids the
// ASCII double hyphen " -- " (and em-dashes); a sha-fallback release on
// a vessel project v1.1.1.1 (2026-10-06) carried "touch -- classifying as build bump".
describe('release text written into vessel repos', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/server.ts'), 'utf-8');

  it('has no " -- " or em-dash in classifier evidence strings', () => {
    const lines = src.split('\n').filter((l) => /evidence\.push\(|classifying as build bump/.test(l));
    expect(lines.length).toBeGreaterThan(5);
    const bad = lines.filter((l) => / -- |—/.test(l));
    expect(bad).toEqual([]);
  });
});
