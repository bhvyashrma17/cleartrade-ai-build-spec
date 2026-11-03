/**
 * The HS 2022 code list the finder searches: the active `cepii:product-codes:HS22` release, indexed once
 * per release and kept in memory (about 5,600 codes).
 */
import { BACI_PRODUCT_CODES_KEY, hsCodeRowSchema } from '@/lib/reference-datasets/baci-products';
import { activeReferenceRows } from '@/lib/reference-datasets/service';
import { buildHsIndex, type HsIndex } from './finder';

let cached: { release_id: string; version: string; index: HsIndex } | null = null;

/** Null while no code list is imported in this environment. */
export async function loadHsIndex(): Promise<{ version: string; index: HsIndex } | null> {
  const active = await activeReferenceRows(BACI_PRODUCT_CODES_KEY, hsCodeRowSchema);
  if (!active) return null;
  if (cached?.release_id !== active.release_id) cached = { release_id: active.release_id, version: active.version, index: buildHsIndex(active.rows) };
  return { version: cached.version, index: cached.index };
}
