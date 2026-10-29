export type DigestStatus = 'ok' | 'retry' | 'fail';

export interface DigestRow {
  job: string;
  owner: string | null;
  /** Total valid events for this job, including retries and failures. */
  runs: number;
  retries: number;
  lastStatus: DigestStatus;
  lastError: string | null;
  /** Original log timestamps, preserving their offsets. */
  firstAt: string;
  lastAt: string;
  /** True if any event failed, even if the job later recovered. */
  hasFailure: boolean;
}

export interface DigestNight {
  /** One row per job, sorted by job name. */
  rows: DigestRow[];
  badLines: number;
  /** Counts of valid events, rather than final job statuses. */
  counts: Record<DigestStatus, number>;
}

/**
 * Read a YYYY-MM-DD night synchronously. Missing files and invalid nights return
 * null; an existing empty file returns an empty DigestNight.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;

/** Accept only calendar dates in YYYY-MM-DD form, never paths. */
export function isValidNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const date = new Date(`${night}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === night;
}
