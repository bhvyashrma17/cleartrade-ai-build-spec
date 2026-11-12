/**
 * Writes the top-30 review's inputs (D-048, docs/38 §3.6): one file per market in
 * docs/regional-review/markets/, what the regional geography says about it today.
 *
 *   npx tsx scripts/regional-review-inputs.ts           # write the 30 files
 *   npx tsx scripts/regional-review-inputs.ts --check   # only report files that differ
 *
 * No network and no database. Run it again after any change to the registry; the tests fail while a
 * committed file differs from what this writes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { REVIEW_INPUTS_DIR, REVIEW_MARKETS, reviewInput, reviewInputFile, serializeReviewInput } from '@/lib/regional-geography/review-inputs';

function main() {
  const check = process.argv.includes('--check');
  const directory = resolve(REVIEW_INPUTS_DIR);
  if (!check) mkdirSync(directory, { recursive: true });
  const stale: string[] = [];
  for (const market of REVIEW_MARKETS) {
    const path = join(directory, reviewInputFile(market));
    const text = serializeReviewInput(reviewInput(market));
    let current: string | null = null;
    try { current = readFileSync(path, 'utf8'); } catch { current = null; }
    if (current === text) continue;
    stale.push(reviewInputFile(market));
    if (!check) writeFileSync(path, text);
  }
  console.log(check ? (stale.length ? `Stale: ${stale.join(', ')}` : 'All 30 inputs are current.') : `Wrote ${stale.length} of 30 files to ${REVIEW_INPUTS_DIR}.`);
  if (check && stale.length) process.exitCode = 1;
}

main();
