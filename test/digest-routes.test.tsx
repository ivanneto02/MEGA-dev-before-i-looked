import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

let runsDir: string;

beforeEach(async () => {
  runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
});

afterEach(async () => {
  await rm(runsDir, { recursive: true, force: true });
});

async function writeNight(night: string, contents: string): Promise<void> {
  await writeFile(join(runsDir, `${night}.jsonl`), contents, 'utf8');
}

function app() {
  return createApp({ ...config, runsDir });
}

describe('digest routes', () => {
  it('serves HTML and JSON for the same sorted jobs', async () => {
    await writeNight(
      '2026-10-28',
      [
        JSON.stringify({ at: '2026-10-28T23:00:00-07:00', job: 'zeta', status: 'ok', owner: 'Zed' }),
        JSON.stringify({ at: '2026-10-28T23:01:00-07:00', job: 'alpha', status: 'ok', owner: 'Ada' }),
        '',
      ].join('\n'),
    );

    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/2026-10-28'),
      app().request('/api/digest/2026-10-28'),
    ]);
    const html = await htmlResponse.text();
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(digest).toMatchObject({
      badLines: 0,
      counts: { ok: 2, retry: 0, fail: 0 },
    });
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'zeta']);
    expect(html.indexOf('alpha')).toBeLessThan(html.indexOf('zeta'));
  });

  it('returns 404 for a night with no file', async () => {
    const [htmlResponse, jsonResponse] = await Promise.all([
      app().request('/digest/2026-10-28'),
      app().request('/api/digest/2026-10-28'),
    ]);

    expect(htmlResponse.status).toBe(404);
    expect(jsonResponse.status).toBe(404);
  });

  it('renders an existing empty night as nothing ran', async () => {
    await writeNight('2026-10-28', '');

    const htmlResponse = await app().request('/digest/2026-10-28');
    const jsonResponse = await app().request('/api/digest/2026-10-28');

    expect(htmlResponse.status).toBe(200);
    expect(await htmlResponse.text()).toContain('nothing ran');
    expect(jsonResponse.status).toBe(200);
    expect(await jsonResponse.json()).toEqual({
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts malformed lines and keeps valid rows, including a null owner', async () => {
    await writeNight(
      '2026-10-28',
      [
        JSON.stringify({ at: '2026-10-28T23:00:00-07:00', job: 'kept', status: 'ok', owner: null }),
        '{not json',
        JSON.stringify({ at: '2026-10-28T23:02:00-07:00', job: 'also-kept', status: 'fail', owner: 'Sam' }),
        '',
      ].join('\n'),
    );

    const htmlResponse = await app().request('/digest/2026-10-28');
    const html = await htmlResponse.text();
    const jsonResponse = await app().request('/api/digest/2026-10-28');
    const digest = await jsonResponse.json();

    expect(htmlResponse.status).toBe(200);
    expect(html).toContain('bad lines: 1');
    expect(html).toContain('—');
    expect(jsonResponse.status).toBe(200);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['also-kept', 'kept']);
    expect(digest.rows.find((row: { job: string }) => row.job === 'kept')?.owner).toBeNull();
  });

  it('marks three or more retries and any failed attempt, and preserves timestamp offsets', async () => {
    await writeNight(
      '2026-10-28',
      [
        JSON.stringify({ at: '2026-10-28T23:00:00+05:30', job: 'many-retries', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T23:01:00+05:30', job: 'many-retries', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T23:02:00+05:30', job: 'many-retries', status: 'retry', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T23:03:00+05:30', job: 'many-retries', status: 'ok', owner: 'Lee' }),
        JSON.stringify({ at: '2026-10-28T23:04:00-07:00', job: 'recovered', status: 'fail', owner: 'Pat', error: 'temporary' }),
        JSON.stringify({ at: '2026-10-28T23:05:00-07:00', job: 'recovered', status: 'ok', owner: 'Pat' }),
        '',
      ].join('\n'),
    );

    const htmlResponse = await app().request('/digest/2026-10-28');
    const html = await htmlResponse.text();
    const jsonResponse = await app().request('/api/digest/2026-10-28');
    const digest = await jsonResponse.json();
    const retryRow = digest.rows.find((row: { job: string }) => row.job === 'many-retries');
    const recoveredRow = digest.rows.find((row: { job: string }) => row.job === 'recovered');

    expect(htmlResponse.status).toBe(200);
    expect(jsonResponse.status).toBe(200);
    expect(retryRow).toMatchObject({ retries: 3, lastStatus: 'ok' });
    expect(recoveredRow).toMatchObject({ retries: 0, lastStatus: 'ok', hasFailure: true });
    expect(html).toContain('<td class="warn">3</td>');
    expect(html).toContain('<td class="warn">ok</td>');
    expect(html.match(/<td class="warn">ok<\/td>/g)).toHaveLength(2);
    expect(html).toContain('2026-10-28T23:00:00+05:30');
    expect(html).toContain('2026-10-28T23:05:00-07:00');
  });

  it('escapes untrusted text and includes no client-side JavaScript', async () => {
    await writeNight(
      '2026-10-28',
      `${JSON.stringify({
        at: '2026-10-28T23:00:00+00:00',
        job: '<img src=x onerror=alert(1)>',
        status: 'fail',
        owner: '<script>alert("owner")</script>',
        error: '<script>alert("error")</script>',
      })}\n`,
    );

    const response = await app().request('/digest/2026-10-28');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert("owner")&lt;/script&gt;');
    expect(html).toContain('&lt;script&gt;alert("error")&lt;/script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<script\b|\son[a-z]+\s*=/i);
  });

  it('rejects invalid calendar dates and path-like night parameters', async () => {
    const invalidDate = await app().request('/digest/2026-02-30');
    const pathLike = await app().request('/api/digest/2026-10-29%2F..%2F..%2Fetc%2Fpasswd');

    expect(invalidDate.status).toBe(404);
    expect(pathLike.status).toBe(404);
  });
});
