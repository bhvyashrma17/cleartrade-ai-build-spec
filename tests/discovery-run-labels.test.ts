import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { JobStatus } from '@prisma/client';
import { runStatusLabel } from '../src/lib/discovery-run-labels';

/**
 * E-056: the Markets page's "Your recent searches" list printed the raw run status ("partial") to a
 * paid member on production. Every status now reads as plain words, the same as the run's chip.
 */
describe('run status labels', () => {
  test('every job status has plain words, never the raw value', () => {
    for (const status of Object.values(JobStatus)) {
      const label = runStatusLabel(status);
      expect(label, status).not.toBe(status);
      expect(label, status).toMatch(/^[A-Z][a-z]+( [a-z]+)*(, [a-z]+ [a-z]+)?$/);
    }
    expect(runStatusLabel('partial')).toBe('Ranked, with gaps');
    expect(runStatusLabel('something new')).toBe('Status unknown');
  });

  test('the recent-searches list uses them, and the chip says the same', () => {
    const source = readFileSync('src/app/app/markets/DemandDiscovery.tsx', 'utf8');
    expect(source).toContain('{runStatusLabel(r.status)}');
    expect(source).not.toContain('{r.status}');
    for (const status of [JobStatus.completed, JobStatus.partial]) expect(source).toContain(`label="${runStatusLabel(status)}"`);
  });
});
