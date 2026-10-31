/**
 * Automatic imports of the keyless public inputs (stage 1, item 4; the recommended default of E-035,
 * built in E-040). Once a day the worker downloads each World Bank indicator and Comtrade reporting
 * list that the freshness rules (`input-freshness.ts`) call missing, due soon or overdue, straight from
 * the publisher, and imports it exactly as an operator would (`importReferenceDataset`): the parser's
 * checks must pass, changed bytes become the active release, unchanged bytes change nothing. It
 * imports as the staff account named in `reference_auto_import_actor_email`; with none, it does
 * nothing and says so. ECGC, India's agreements, sanctions and pegs stay curated operator steps,
 * BACI needs the owner's download, and tariffs have their own refresh.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { importReferenceDataset, REFERENCE_DATASET_IMPORT_PRINCIPALS } from '@/lib/reference-datasets/service';
import type { Principal } from '@/types';
import { loadInputFreshness } from './input-freshness';

const WDI_URL = (indicator: string) => `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&mrnev=1`;
const GETDA_URL = (year: number) => `https://comtradeapi.un.org/public/v1/getDa/C/A/HS?period=${year}`;
const DUE: readonly string[] = ['missing', 'due_soon', 'overdue'];

/** The publisher URL a keyless input is downloaded from, as the operator runbook gives it (docs/36 §10); null for any other input. */
export function autoImportSource(key: string): string | null {
  const wdi = /^wdi:([A-Z0-9.]+)$/.exec(key);
  if (wdi) return WDI_URL(wdi[1]!);
  const availability = /^comtrade:availability:(\d{4})$/.exec(key);
  return availability ? GETDA_URL(Number(availability[1])) : null;
}

export interface AutoImportResult {
  /** The account the imports ran as, or null when none is configured (then nothing ran). */
  actor: string | null;
  due: string[];
  imported: { key: string; change: 'NEW' | 'UNCHANGED'; release_id: string; version: string }[];
  failed: { key: string; reason: string }[];
}

async function importActor(email: string | null): Promise<Principal | null> {
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.is_active || !REFERENCE_DATASET_IMPORT_PRINCIPALS.includes(user.role)) return null;
  return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim().slice(0, 300) || 'Failed without a message.';

/** Null when switched off. `actor_email` (instead of the config's) and `fetchImpl` are seams for tests. */
export async function autoImportReferenceData(options: { now?: Date; fetchImpl?: typeof fetch; timeout_ms?: number; actor_email?: string | null } = {}): Promise<AutoImportResult | null> {
  const config = await getConfig('demand_discovery.v5');
  if (!config.reference_auto_import) return null;
  const now = options.now ?? new Date();
  const due = (await loadInputFreshness(now)).filter((row) => DUE.includes(row.status) && autoImportSource(row.key) != null).map((row) => row.key);
  const email = options.actor_email !== undefined ? options.actor_email : config.reference_auto_import_actor_email;
  const actor = await importActor(email);
  const result: AutoImportResult = { actor: actor?.email ?? null, due, imported: [], failed: [] };
  if (!due.length) return result;
  if (!actor) {
    const reason = `No active ops supervisor or admin account ${email ? `matches ${email}` : 'is configured (reference_auto_import_actor_email)'} to import as.`;
    result.failed = due.map((key) => ({ key, reason }));
    return result;
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  for (const key of due) {
    const url = autoImportSource(key)!;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeout_ms ?? 60_000), headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`The publisher answered HTTP ${response.status}.`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('The publisher sent an empty file.');
      const imported = await importReferenceDataset({ actor, dataset_key: key, bytes, source_url: url, retrieved_at: now, correlation_id: `reference-auto-import:${randomUUID()}` });
      result.imported.push({ key, change: imported.change, release_id: imported.release_id, version: imported.version });
    } catch (error) {
      result.failed.push({ key, reason: reasonOf(error) });
    }
  }
  return result;
}
