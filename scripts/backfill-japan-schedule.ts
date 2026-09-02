/**
 * Imports the complete official Japan Customs tariff schedule, one chapter at a time.
 *
 * Japan publishes a full schedule per effective date, as one HTML page per HS chapter. Wave 1B
 * imported a single chapter to prove the mechanism; this brings coverage to the whole schedule
 * without introducing any new architecture — it drives the existing
 * `acquireAndImportJapanChapterRelease` in a loop.
 *
 *   npx tsx scripts/backfill-japan-schedule.ts --actor-email=ops@example.com --date=2026_08_08 --activate
 *   npx tsx scripts/backfill-japan-schedule.ts --actor-email=... --date=... --activate --only=84,85
 *
 * Properties this loop is required to have, and how each is obtained:
 *
 *  - Discovered, not hardcoded. Chapters come from the authority's own dated index page, so a
 *    schedule that adds or retires a chapter is followed rather than assumed. (HS chapter 77 is
 *    reserved and genuinely absent; hardcoding 1..97 would manufacture a phantom failure.)
 *  - Idempotent. `importAuthorityRelease` resolves an identical (source, release, checksum) to the
 *    existing row, so a re-run imports nothing new and reports `unchanged`.
 *  - Resumable. Because it is idempotent, interruption needs no checkpoint file: re-running
 *    completes the remainder and no-ops the rest.
 *  - Failure-isolated. Each chapter is caught individually; chapter 84 failing cannot roll back or
 *    corrupt chapter 83, because each release is its own immutable row and its own transaction.
 *  - Memory-bounded. One chapter is held at a time (largest observed ~2.25MB), and nothing
 *    accumulates across iterations — the loop never builds a whole-schedule structure.
 *  - Concurrency-bounded. Strictly sequential, with a pause between chapters. PDL 1.0 documents no
 *    rate-limit policy, so this stays a conservative reader rather than fanning out 96 parallel
 *    requests at a government web server.
 *  - Observable. One progress line per chapter, plus a machine-readable summary at the end.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { acquireAndImportJapanChapterRelease } from '@/lib/market-access/providers/japan-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

const INDEX_HOST = 'https://www.customs.go.jp';
/** Between-chapter pause. Deliberately unhurried: ~96 chapters is a courtesy budget, not a race. */
const CHAPTER_PAUSE_MS = Number(arg('pause-ms') ?? 750);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

/** Reads the authority's own dated index and returns the chapters it actually publishes. */
async function discoverChapters(dateLabel: string): Promise<string[]> {
  const url = `${INDEX_HOST}/english/tariff/${dateLabel}/index.htm`;
  const response = await fetch(url, { headers: { 'user-agent': 'ClearTrade-Customs-Atlas/1.0 (schedule discovery)' } });
  if (!response.ok) throw new Error(`Japan Customs index ${url} returned HTTP ${response.status}`);
  // Shift_JIS page, but chapter hrefs are pure ASCII, which latin1 preserves byte-for-byte.
  const html = Buffer.from(await response.arrayBuffer()).toString('latin1');
  const chapters = new Set<string>();
  for (const match of html.matchAll(/data\/e_(\d{2})\.htm/g)) chapters.add(match[1]!);
  if (!chapters.size) throw new Error(`No chapter links found on ${url}; the index layout may have changed.`);
  return [...chapters].sort();
}

interface ChapterOutcome {
  chapter: string;
  status: 'imported' | 'unchanged' | 'failed';
  release_id?: string;
  change?: string;
  rows?: number;
  bytes?: number;
  ms: number;
  error?: string;
}

async function main() {
  const actorEmail = required('actor-email').toLowerCase();
  const dateLabel = required('date');
  if (!/^\d{4}_\d{2}_\d{2}$/.test(dateLabel)) throw new Error('--date must look like 2026_08_08.');
  const activate = flag('activate');

  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const only = arg('only')?.split(',').map((c) => c.trim().padStart(2, '0')).filter(Boolean);
  const discovered = await discoverChapters(dateLabel);
  const chapters = only?.length ? discovered.filter((c) => only.includes(c)) : discovered;
  console.log(`Japan schedule ${dateLabel}: ${discovered.length} chapters published, ${chapters.length} to process.`);

  const outcomes: ChapterOutcome[] = [];
  let peakRss = process.memoryUsage().rss;

  for (const [index, chapter] of chapters.entries()) {
    const startedAt = Date.now();
    try {
      const imported = await acquireAndImportJapanChapterRelease({
        actor,
        chapter,
        effective_date_label: dateLabel,
        activate,
        correlation_id: randomUUID(),
        acquisition: {
          effective_date_label: dateLabel,
          chapter,
          chapter_url: `${INDEX_HOST}/english/tariff/${dateLabel}/data/e_${chapter}.htm`,
        },
      });
      const validation = imported.release.validation as { row_count?: number } | null;
      outcomes.push({
        chapter,
        status: imported.created ? 'imported' : 'unchanged',
        release_id: imported.release.id,
        change: imported.change,
        rows: validation?.row_count,
        bytes: imported.release.size_bytes,
        ms: Date.now() - startedAt,
      });
    } catch (error) {
      // Isolated: a bad chapter is recorded and skipped. Chapters already imported stay valid,
      // and a re-run retries only what did not land.
      outcomes.push({ chapter, status: 'failed', ms: Date.now() - startedAt, error: error instanceof Error ? error.message : String(error) });
    }

    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
    const last = outcomes[outcomes.length - 1]!;
    console.log(
      `[${String(index + 1).padStart(2)}/${chapters.length}] ch${chapter} ${last.status}`
      + `${last.rows === undefined ? '' : ` rows=${last.rows}`}`
      + `${last.bytes === undefined ? '' : ` bytes=${last.bytes}`}`
      + ` ${last.ms}ms rss=${(rss / 1e6).toFixed(0)}MB`
      + `${last.error ? ` error=${last.error}` : ''}`,
    );

    if (index < chapters.length - 1) await new Promise((r) => setTimeout(r, CHAPTER_PAUSE_MS));
  }

  const imported = outcomes.filter((o) => o.status === 'imported');
  const unchanged = outcomes.filter((o) => o.status === 'unchanged');
  const failed = outcomes.filter((o) => o.status === 'failed');
  console.log('\n=== Japan schedule backfill summary ===');
  console.log(JSON.stringify({
    schedule_date: dateLabel,
    chapters_published: discovered.length,
    chapters_attempted: chapters.length,
    chapters_imported: imported.length,
    chapters_unchanged: unchanged.length,
    chapters_failed: failed.length,
    total_rows: outcomes.reduce((sum, o) => sum + (o.rows ?? 0), 0),
    total_bytes: outcomes.reduce((sum, o) => sum + (o.bytes ?? 0), 0),
    peak_rss_mb: Number((peakRss / 1e6).toFixed(1)),
    total_ms: outcomes.reduce((sum, o) => sum + o.ms, 0),
    failures: failed.map((f) => ({ chapter: f.chapter, error: f.error })),
  }, null, 2));

  if (failed.length) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
