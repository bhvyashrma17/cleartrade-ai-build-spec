/**
 * Imports ABF Working Tariff chapters, one at a time, with the same properties as the Japan
 * backfill: discovered rather than hardcoded, idempotent, resumable, failure-isolated,
 * memory-bounded, sequential and observable. See `backfill-japan-schedule.ts` for why each of
 * those matters; the reasoning is identical and is not repeated here.
 *
 *   npx tsx scripts/backfill-australia-schedule.ts --actor-email=ops@example.com --release=2026-09 --activate
 *   npx tsx scripts/backfill-australia-schedule.ts --actor-email=... --release=... --activate --only=61,84
 *
 * Australia differs from Japan in one respect: a chapter lives under its HS section, so the
 * section→chapter map is discovered by walking Schedule 3's own section index rather than being
 * assumed from the chapter number.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { acquireAndImportAustraliaChapterRelease } from '@/lib/market-access/providers/australia-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

const HOST = 'https://www.abf.gov.au';
const TARIFF_ROOT = `${HOST}/importing-exporting-and-manufacturing/tariff-classification/current-tariff`;
const SCHEDULE_10A_URL = `${TARIFF_ROOT}/schedule-10a`;
const PAUSE_MS = Number(arg('pause-ms') ?? 750);

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; ClearTrade-Customs-Atlas/1.0)', accept: 'text/html' };

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function getHtml(url: string) {
  const response = await fetch(url, { headers: UA });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return await response.text();
}

/** Walks Schedule 3's section index, then each section, to map chapter number → chapter URL. */
async function discoverChapters(): Promise<Map<string, string>> {
  const scheduleHtml = await getHtml(`${TARIFF_ROOT}/schedule-3`);
  const sections = [...new Set([...scheduleHtml.matchAll(/schedule-3\/(section-[a-z]+)"/g)].map((m) => m[1]!))];
  if (!sections.length) throw new Error('No Schedule 3 sections found; the ABF index layout may have changed.');
  const chapters = new Map<string, string>();
  for (const section of sections) {
    const html = await getHtml(`${TARIFF_ROOT}/schedule-3/${section}`);
    // The section it belongs to must come from the matched href, not from the page being scanned:
    // ABF pages carry navigation linking chapters across every section, so attributing them to the
    // current page's section maps every chapter to section-i and 404s on fetch.
    for (const match of html.matchAll(/schedule-3\/(section-[a-z]+)\/chapter-(\d{1,2})"/g)) {
      const chapter = match[2]!.padStart(2, '0');
      if (!chapters.has(chapter)) chapters.set(chapter, `${TARIFF_ROOT}/schedule-3/${match[1]}/chapter-${match[2]}`);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  return chapters;
}

async function main() {
  const actorEmail = required('actor-email').toLowerCase();
  const releaseIdentifier = required('release');
  const activate = flag('activate');
  const referenceDate = new Date(`${arg('reference-date') ?? '2026-07-01'}T00:00:00.000Z`);
  if (Number.isNaN(referenceDate.getTime())) throw new Error('--reference-date must be YYYY-MM-DD.');

  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const discovered = await discoverChapters();
  const only = arg('only')?.split(',').map((c) => c.trim().padStart(2, '0')).filter(Boolean);
  const chapters = [...discovered.keys()].sort().filter((c) => !only?.length || only.includes(c));
  console.log(`ABF Working Tariff ${releaseIdentifier}: ${discovered.size} chapters discovered, ${chapters.length} to process.`);

  const outcomes: Array<Record<string, unknown>> = [];
  let peakRss = process.memoryUsage().rss;

  for (const [index, chapter] of chapters.entries()) {
    const startedAt = Date.now();
    let status = 'failed';
    let detail: Record<string, unknown> = {};
    try {
      const imported = await acquireAndImportAustraliaChapterRelease({
        actor, chapter, release_identifier: releaseIdentifier, reference_date: referenceDate,
        activate, correlation_id: randomUUID(),
        acquisition: {
          release_identifier: releaseIdentifier, chapter,
          chapter_url: discovered.get(chapter)!, schedule_10a_url: SCHEDULE_10A_URL,
        },
      });
      const validation = imported.release.validation as { row_count?: number; india_exception_count?: number } | null;
      status = imported.created ? 'imported' : 'unchanged';
      detail = { rows: validation?.row_count, india_exceptions: validation?.india_exception_count, bytes: imported.release.size_bytes };
    } catch (error) {
      detail = { error: error instanceof Error ? error.message : String(error) };
    }
    const ms = Date.now() - startedAt;
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
    outcomes.push({ chapter, status, ms, ...detail });
    console.log(`[${String(index + 1).padStart(2)}/${chapters.length}] ch${chapter} ${status} ${JSON.stringify(detail)} ${ms}ms rss=${(rss / 1e6).toFixed(0)}MB`);
    if (index < chapters.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  const by = (s: string) => outcomes.filter((o) => o.status === s);
  console.log('\n=== ABF backfill summary ===');
  console.log(JSON.stringify({
    release: releaseIdentifier,
    chapters_discovered: discovered.size,
    chapters_attempted: chapters.length,
    chapters_imported: by('imported').length,
    chapters_unchanged: by('unchanged').length,
    chapters_failed: by('failed').length,
    total_rows: outcomes.reduce((s, o) => s + (Number(o.rows) || 0), 0),
    peak_rss_mb: Number((peakRss / 1e6).toFixed(1)),
    failures: by('failed').map((f) => ({ chapter: f.chapter, error: f.error })),
  }, null, 2));
  if (by('failed').length) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
