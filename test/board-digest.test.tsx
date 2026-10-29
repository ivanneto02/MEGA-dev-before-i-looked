import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('status board digest links', () => {
  let runsDir: string;
  afterEach(() => { if (runsDir) rmSync(runsDir, { recursive: true, force: true }); });

  it('links every night on disk and shows counts of valid events', async () => {
    runsDir = mkdtempSync(join(tmpdir(), 'rig-board-'));
    const rows = [
      { at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'ok', owner: null },
      { at: '2026-10-28T23:01:00+01:00', job: 'b', status: 'retry', owner: 'rook' },
      { at: '2026-10-28T23:02:00+01:00', job: 'c', status: 'ok', owner: 'rook' },
      { at: '2026-10-28T23:03:00+01:00', job: 'd', status: 'fail', owner: 'rook' },
    ];
    writeFileSync(join(runsDir, '2026-10-28.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
    writeFileSync(join(runsDir, '2026-10-27.jsonl'), '');

    const response = await createApp({
      adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
    }).request('/');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('href="/digest/2026-10-28"');
    expect(html).toContain('2 ok · 1 retry · 1 fail');
    expect(html).toContain('href="/digest/2026-10-27"');
    expect(html).toContain('0 ok · 0 retry · 0 fail');
  });
});
