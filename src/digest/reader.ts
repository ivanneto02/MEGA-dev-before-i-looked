import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isValidNight, type DigestRow, type DigestStatus, type ReadNight } from './types.js';

interface RunEvent {
  at: string;
  job: string;
  status: DigestStatus;
  owner: string | null;
  error?: string;
}

function isRunEvent(value: unknown): value is RunEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return typeof event.at === 'string'
    && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(event.at)
    && isValidNight(event.at.slice(0, 10))
    && Number.isFinite(Date.parse(event.at))
    && typeof event.job === 'string' && event.job.trim().length > 0
    && (event.status === 'ok' || event.status === 'retry' || event.status === 'fail')
    && (typeof event.owner === 'string' || event.owner === null)
    && (event.error === undefined || typeof event.error === 'string');
}

/** Read-only aggregation; invalid records cannot discard an otherwise useful night. */
export const readNight: ReadNight = (runsDir, night) => {
  if (!isValidNight(night)) return null;
  let content: string;
  try {
    content = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const jobs = new Map<string, { row: DigestRow; first: number; last: number; errorAt: number }>();
  const counts = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!isRunEvent(event)) {
      badLines++;
      continue;
    }

    counts[event.status]++;
    const at = Date.parse(event.at);
    let aggregate = jobs.get(event.job);
    if (!aggregate) {
      aggregate = {
        row: {
          job: event.job, owner: event.owner, runs: 0, retries: 0,
          lastStatus: event.status, lastError: null, firstAt: event.at, lastAt: event.at,
          hasFailure: false,
        },
        first: at, last: at, errorAt: -Infinity,
      };
      jobs.set(event.job, aggregate);
    }
    const { row } = aggregate;
    row.runs++;
    if (event.status === 'retry') row.retries++;
    if (event.status === 'fail') row.hasFailure = true;
    if (at < aggregate.first) {
      aggregate.first = at;
      row.firstAt = event.at;
    }
    // For equal timestamps, the later line wins status, owner, and error ties.
    if (at >= aggregate.last) {
      aggregate.last = at;
      row.lastAt = event.at;
      row.lastStatus = event.status;
      row.owner = event.owner;
    }
    if (event.error !== undefined && at >= aggregate.errorAt) {
      aggregate.errorAt = at;
      row.lastError = event.error;
    }
  }

  const rows = [...jobs.values()].map(({ row }) => row)
    .sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0);
  return { rows, badLines, counts };
};
