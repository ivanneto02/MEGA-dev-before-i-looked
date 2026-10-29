import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const clean = process.argv.includes('--clean');
const port = '18787';
const child = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/server.ts'], {
  env: { ...process.env, PORT: port, ...(clean ? { LANE_MARKER: '' } : {}) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
child.stdout.on('data', data => { logs += data; });
child.stderr.on('data', data => { logs += data; });
try {
  let html;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/digest/2026-10-28`);
      if (!response.ok) throw new Error(`Digest returned ${response.status}`);
      html = await response.text();
      break;
    } catch (error) {
      if (error.cause?.code !== 'ECONNREFUSED') throw error;
      await delay(100);
    }
  }
  if (!html) throw new Error('Timed out waiting for the digest server');
  if (!html.startsWith('<!doctype html>') || html.includes('<script')) throw new Error('Expected self-contained HTML');
  if (clean && !html.includes('no marker set')) throw new Error('Clean preview still has a marker');
  if (!clean && html.includes('no marker set')) throw new Error('Review preview needs LANE_MARKER');
  await mkdir('var/preview', { recursive: true });
  await writeFile('var/preview/index.html', html);
  console.log(`Captured ${clean ? 'clean' : 'review'} preview to var/preview/index.html`);
} finally {
  child.kill('SIGTERM');
}
