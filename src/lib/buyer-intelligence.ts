import { Prisma, TradeDataSource } from '@prisma/client';
import { importRecordUseWhere } from '@/lib/import-record-rights';
import { prisma } from '@/lib/prisma';

export const BUYER_FIT_MODEL_VERSION = 'buyer-fit-v1';
const LEGAL_SUFFIXES = new Set(['LLC','INC','LTD','LIMITED','CORP','CORPORATION','CO','COMPANY','GMBH','PLC','LP','LLP','SA','BV']);
const INTERMEDIARY = /\b(FREIGHT|FORWARDER|FORWARDING|CUSTOMS BROKER|BROKERAGE|LOGISTICS|NVOCC)\b/i;

export function normalizeEntityName(value: string) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\bG\s+M\s+B\s+H\b/g, 'GMBH')
    .split(/\s+/).filter(Boolean).filter((token) => !LEGAL_SUFFIXES.has(token)).join(' ');
}
function similarity(a: string, b: string) {
  if (a === b) return 1;
  const aa = new Set(a.split(' ')), bb = new Set(b.split(' '));
  const intersection = [...aa].filter((x) => bb.has(x)).length;
  return intersection / Math.max(aa.size, bb.size);
}
function median(values: number[]) { const sorted = [...values].sort((a,b)=>a-b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; }
function clamp(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }
type Component = { score: number | null; reason?: string; evidence: Record<string, unknown> };
function combine(parts: Record<string, Component>) {
  const available = Object.values(parts).filter((part) => part.score != null);
  return available.length ? clamp(available.reduce((sum, part) => sum + part.score!, 0) / available.length) : null;
}

export async function runBuyerIntelligence(input: { exporter_org_id: string; product_id: string }) {
  const product = await prisma.product.findFirstOrThrow({ where: { id: input.product_id, exporter_org_id: input.exporter_org_id }, include: { certifications: true } });
  const records = await prisma.importRecord.findMany({ where: { source: TradeDataSource.cbp_vessel_manifest, buyer_id: null, raw_consignee_string: { not: null }, ...importRecordUseWhere('cache') }, orderBy: { shipment_date: 'asc' } });
  const known = await prisma.buyer.findMany({ include: { attribute_claims: { where: { attribute: 'name' } } } });
  let resolved = 0;
  for (const record of records) {
    const normalized = normalizeEntityName(record.raw_consignee_string!);
    if (!normalized) continue;
    let best: { id: string; score: number } | null = null;
    for (const buyer of known) {
      if (buyer.country_code !== record.country) continue;
      const names = [buyer.legal_name, ...buyer.attribute_claims.map((claim) => String(claim.value))];
      const score = Math.max(...names.map((name) => similarity(normalized, normalizeEntityName(name.replace(/^"|"$/g, '')))));
      if (!best || score > best.score) best = { id: buyer.id, score };
    }
    let buyerId: string, confidence: number, method: string;
    if (best && best.score >= 0.8) { buyerId = best.id; confidence = best.score; method = best.score === 1 ? 'normalized_exact' : 'token_similarity'; }
    else {
      const buyer = await prisma.buyer.create({ data: { legal_name: record.raw_consignee_string!, display_name: record.raw_consignee_string!, country_code: record.country, buyer_type: INTERMEDIARY.test(normalized) ? 'intermediary' : 'importer' } });
      known.push({ ...buyer, attribute_claims: [] }); buyerId = buyer.id; confidence = 1; method = 'new_canonical';
    }
    await prisma.$transaction([
      prisma.importRecord.update({ where: { id: record.id }, data: { buyer_id: buyerId, resolution_confidence: confidence, resolution_method: method, resolved_at: new Date() } }),
      prisma.buyerAttributeClaim.upsert({ where: { buyer_id_attribute_source_source_record_id: { buyer_id: buyerId, attribute: 'name', source: record.source, source_record_id: record.source_record_id } }, create: { buyer_id: buyerId, attribute: 'name', value: record.raw_consignee_string!, source: record.source, source_record_id: record.source_record_id, observed_at: record.shipment_date }, update: { value: record.raw_consignee_string!, observed_at: record.shipment_date } }),
      prisma.buyerAttributeClaim.upsert({ where: { buyer_id_attribute_source_source_record_id: { buyer_id: buyerId, attribute: 'country_code', source: record.source, source_record_id: record.source_record_id } }, create: { buyer_id: buyerId, attribute: 'country_code', value: record.country, source: record.source, source_record_id: record.source_record_id, observed_at: record.shipment_date }, update: { value: record.country, observed_at: record.shipment_date } }),
    ]);
    resolved++;
  }

  const buyers = await prisma.buyer.findMany({ include: { import_records: { where: importRecordUseWhere('cache'), orderBy: { shipment_date: 'asc' } }, outcomes: true } });
  const sanctions = await prisma.sanctionsEntity.findMany({ where: { is_active: true } });
  let surfaced = 0;
  for (const buyer of buyers) {
    const rows = buyer.import_records;
    if (!rows.length) continue;
    const last = rows.at(-1)!.shipment_date;
    const reasons: string[] = [];
    if (INTERMEDIARY.test(buyer.legal_name)) reasons.push('intermediary');
    if (last < new Date(Date.now() - 548 * 86400000)) reasons.push('inactive_importer');
    const sanction = sanctions.find((entry) => similarity(normalizeEntityName(buyer.legal_name), entry.normalized_name) >= 0.92);
    const riskFlags = sanction ? [{ code: 'sanctions_hit', severity: 'critical', summary: `Potential match from ${sanction.source}`, source_record_id: sanction.source_record_id }] : [];
    const now = new Date(); const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    const recent = rows.filter((row) => row.shipment_date >= cutoff);
    const units = new Map<string, number>(); for (const row of rows) if (row.quantity && row.quantity_unit) units.set(row.quantity_unit, (units.get(row.quantity_unit) ?? 0) + 1);
    const unit = [...units.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? null;
    const quantities = rows.filter((row) => row.quantity && row.quantity_unit === unit).map((row) => Number(row.quantity));
    const origins = new Map<string, number>(); for (const row of rows) if (row.origin_country) origins.set(row.origin_country, (origins.get(row.origin_country) ?? 0) + 1);
    const suppliers = new Map<string, number>(); for (const row of rows) if (row.shipper_name) suppliers.set(normalizeEntityName(row.shipper_name), (suppliers.get(normalizeEntityName(row.shipper_name)) ?? 0) + 1);
    const hhi = suppliers.size ? [...suppliers.values()].reduce((sum,n)=>sum+(n/rows.length)**2,0) : null;
    const mid = new Date(now.getTime()-182*86400000), prior = new Date(now.getTime()-365*86400000);
    const currentCount = rows.filter(r=>r.shipment_date>=mid).length, priorCount=rows.filter(r=>r.shipment_date>=prior&&r.shipment_date<mid).length;
    const trend = priorCount ? (currentCount-priorCount)/priorCount : null;
    const provenance = { source: 'ImportRecord', source_record_ids: rows.map(r=>r.source_record_id), computed_at: now.toISOString() };
    await prisma.$transaction([
      prisma.buyer.update({ where: { id: buyer.id }, data: { last_activity_at: last, deprioritized: reasons.length > 0, deprioritization_reasons: reasons, sanctions_blocked: Boolean(sanction), risk_flags: riskFlags, import_activity_summary: { shipment_count: rows.length, last_shipment_date: last.toISOString(), scope: 'observed_us_vessel_manifests_only' } } }),
      prisma.buyerFeatureSnapshot.upsert({ where: { buyer_id: buyer.id }, create: { buyer_id: buyer.id, import_frequency_per_year: rows.length / Math.max(1,(last.getTime()-rows[0].shipment_date.getTime())/(365*86400000)), last_shipment_date: last, shipment_count_12m: recent.length, typical_shipment_size: median(quantities), quantity_unit: unit, origin_mix: Object.fromEntries(origins), india_sourcing_history: origins.size ? origins.has('IN') : null, supplier_concentration: hhi, purchasing_trend: trend, provenance }, update: { import_frequency_per_year: rows.length / Math.max(1,(last.getTime()-rows[0].shipment_date.getTime())/(365*86400000)), last_shipment_date: last, shipment_count_12m: recent.length, typical_shipment_size: median(quantities), quantity_unit: unit, origin_mix: Object.fromEntries(origins), india_sourcing_history: origins.size ? origins.has('IN') : null, supplier_concentration: hhi, purchasing_trend: trend, provenance, computed_at: now } }),
    ]);
    if (sanction || reasons.length) continue;
    const relevant = product.hs_code ? rows.some(row => row.hs_code?.startsWith(product.hs_code!.slice(0, Math.min(6, product.hs_code!.length)))) : false;
    const typical = median(quantities);
    const volume: Component = typical != null && unit && product.capacity_value && product.capacity_unit === unit && product.moq_value && product.moq_unit === unit
      ? { score: typical >= Number(product.moq_value) && typical <= Number(product.capacity_value) ? 100 : clamp(100 - 50 * Math.abs(Math.log10(typical / (typical < Number(product.moq_value) ? Number(product.moq_value) : Number(product.capacity_value))))), evidence: { typical, unit, capacity: product.capacity_value.toString(), moq: product.moq_value.toString() } }
      : { score: null, reason: 'Comparable buyer quantity, exporter capacity, and MOQ are not all available in the same unit.', evidence: {} };
    const prices = rows.filter(r=>r.value&&r.value_currency&&r.quantity&&r.quantity.gt(0)).map(r=>({ value:Number(r.value!.div(r.quantity!)), currency:r.value_currency! }));
    const comparable = product.price_target_currency ? prices.filter(p=>p.currency===product.price_target_currency) : [];
    const typicalPrice = median(comparable.map(p=>p.value));
    const price: Component = typicalPrice != null && product.price_target_amount ? { score: clamp(100-100*Math.abs(Math.log(typicalPrice/Number(product.price_target_amount)))), evidence: { typical_unit_value: typicalPrice, currency: product.price_target_currency } } : { score:null, reason:'Comparable unit-value evidence is unavailable.', evidence:{} };
    const requirements = await prisma.marketEligibilityRule.findMany({ where: { country_code: 'US', is_active: true, rule_type: 'mandatory_certification', OR: [{ hs_code_prefix: null }, ...(product.hs_code ? [{ hs_code_prefix: { startsWith: product.hs_code.slice(0,2) } }] : [])] } });
    const held = new Set(product.certifications.filter(c=>c.status==='held').map(c=>c.code.toUpperCase()));
    const cert: Component = requirements.length ? { score: requirements.every(r=>r.required_certification&&held.has(r.required_certification.toUpperCase())) ? 100 : 0, evidence: { requirement_ids: requirements.map(r=>r.id), held: [...held] } } : { score:null, reason:'No sourced destination certification requirements.', evidence:{} };
    const completed = buyer.outcomes.filter(o=>o.converted!=null); const conversions=completed.filter(o=>o.converted).length;
    const outcome: Component = completed.length ? { score: clamp(100*(conversions+1)/(completed.length+2)), evidence:{observations:completed.length,conversions} } : { score:null, reason:'No outcome history yet.', evidence:{} };
    const procurementCompatible = typical == null || !product.capacity_value || !unit || product.capacity_unit !== unit || typical <= Number(product.capacity_value);
    const components = { volume_fit: volume, price_fit: price, cert_fit: cert, outcome_prior: outcome, relevance: relevant, procurement_compatible: procurementCompatible };
    const componentsJson = components as unknown as Prisma.InputJsonValue;
    const score = relevant && procurementCompatible ? combine({volume,price,cert,outcome}) : null;
    const confidence = clamp(100 * Object.values({volume,price,cert,outcome}).filter(c=>c.score!=null).length / 4);
    await prisma.buyerFitAssessment.upsert({ where: { buyer_id_product_id_exporter_org_id: { buyer_id:buyer.id,product_id:product.id,exporter_org_id:input.exporter_org_id } }, create: { buyer_id:buyer.id,product_id:product.id,exporter_org_id:input.exporter_org_id,score,confidence_score:confidence,components:componentsJson,input_snapshot:{ product_id:product.id, hs_code:product.hs_code, rows:rows.map(r=>r.source_record_id) },model_version:BUYER_FIT_MODEL_VERSION }, update:{score,confidence_score:confidence,components:componentsJson,input_snapshot:{ product_id:product.id, hs_code:product.hs_code, rows:rows.map(r=>r.source_record_id) },model_version:BUYER_FIT_MODEL_VERSION,computed_at:now} });
    if (score != null) surfaced++;
  }
  return { resolved, buyers_evaluated: buyers.length, surfaced };
}
