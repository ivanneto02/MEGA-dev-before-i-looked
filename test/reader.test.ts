import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: null };

describe('readNight', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'rig-reader-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });
  const fixtureDir = new URL('../runs/', import.meta.url).pathname;

  it('aggregates the real fixture, retains null owners and errors after recovery', () => {
    const digest = readNight(fixtureDir, night);
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(digest?.rows.map(row => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest?.rows[0]).toMatchObject({ owner: null, runs: 1, lastError: null });
    expect(digest?.rows[1]).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' });
    expect(digest?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastError: 'lock held' });
    expect(digest?.rows[3]).toMatchObject({ hasFailure: true, lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('orders timestamps by instant, preserves offsets, and retains historical failure and latest error', () => {
    const events = [
      { ...event, at: '2026-10-29T01:00:00+03:00', owner: null },
      { ...event, at: '2026-10-28T23:30:00+02:00', status: 'retry', owner: 'new', error: 'new error' },
      { ...event, at: '2026-10-28T23:00:00+02:00', status: 'fail', owner: 'old', error: 'old error' },
    ];
    writeFileSync(join(dir, `${night}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'));
    expect(readNight(dir, night)).toEqual({
      badLines: 0, counts: { ok: 1, retry: 1, fail: 1 },
      rows: [{ job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
        firstAt: '2026-10-28T23:00:00+02:00', lastAt: '2026-10-29T01:00:00+03:00', hasFailure: true }],
    });
  });

  it('counts malformed JSON and invalid event shapes without losing valid records', () => {
    const invalid = [null, [], 'text', 42, {}, { ...event, job: '' }, { ...event, job: 1 },
      { ...event, at: 'not a date' }, { ...event, at: '2026-02-30T00:00:00Z' },
      { ...event, at: '2026-10-28T23:00:00' }, { ...event, status: 'unknown' },
      { ...event, owner: undefined }, { ...event, owner: {} }, { ...event, error: 123 }];
    const lines = [JSON.stringify(event), ...invalid.map(e => JSON.stringify(e)), '{bad', JSON.stringify({ ...event, job: '__proto__' })];
    writeFileSync(join(dir, `${night}.jsonl`), lines.join('\r\n') + '\r\n\n  \n');
    const digest = readNight(dir, night);
    expect(digest?.badLines).toBe(invalid.length + 1);
    expect(digest?.rows.map(row => row.job)).toEqual(['__proto__', 'job']);
    expect(digest?.counts).toEqual({ ok: 2, retry: 0, fail: 0 });
  });

  it('distinguishes missing files from empty and wholly malformed nights', () => {
    expect(readNight(dir, night)).toBeNull();
    writeFileSync(join(dir, `${night}.jsonl`), '');
    expect(readNight(dir, night)).toEqual({ rows: [], badLines: 0, counts: { ok: 0, retry: 0, fail: 0 } });
    writeFileSync(join(dir, `${night}.jsonl`), 'bad');
    expect(readNight(dir, night)).toEqual({ rows: [], badLines: 1, counts: { ok: 0, retry: 0, fail: 0 } });
  });

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../../x', '2026-02-29', '2026-13-01', '2026-10-28.jsonl'])('rejects invalid night %s', value => {
    expect(readNight(dir, value)).toBeNull();
  });

  it('propagates filesystem errors other than missing files', () => {
    mkdirSync(join(dir, `${night}.jsonl`));
    expect(() => readNight(dir, night)).toThrow();
  });
});
