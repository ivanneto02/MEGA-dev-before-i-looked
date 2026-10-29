import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { DigestStatus } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightSummary = {
  night: string;
  counts: Record<DigestStatus, number>;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: string[];
  nightSummaries: NightSummary[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export function readStatus(config: RigConfig): Status {
  const nights = nightsOnDisk(config.runsDir);
  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
    nightSummaries: nights.map((night) => ({
      night,
      counts: readNight(config.runsDir, night)?.counts ?? { ok: 0, retry: 0, fail: 0 },
    })),
  };
}
