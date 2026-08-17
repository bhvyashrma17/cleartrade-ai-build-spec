import { BuyerLeadStage, EvidenceOrigin, OrgTier, TradeDataSource, UserRole } from '@prisma/client';
import { runBuyerIntelligence, normalizeEntityName } from '@/lib/buyer-intelligence';
import { recordBuyerOutcomeTransition } from '@/lib/buyer-outcomes';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const marker = 'verify-buyer-intelligence';
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(`FAIL: ${message}`); console.log(`PASS: ${message}`); }

async function main() {
  const old = await prisma.exporterOrg.findFirst({ where: { display_name: marker } });
  if (old) await prisma.exporterOrg.delete({ where: { id: old.id } });
  await prisma.importRecord.deleteMany({ where: { source_record_id: { startsWith: marker } } });
  await prisma.buyer.deleteMany({ where: { source_evidence: { some: { source_ref: marker } } } });
  await prisma.sanctionsEntity.deleteMany({ where: { source: marker } });
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Towels', hs_code: '630260', hs_code_source: 'user_confirmed',evidence_origin:EvidenceOrigin.fixture, capacity_value: 100, capacity_unit: 'CTN', moq_value: 10, moq_unit: 'CTN', price_target_amount: 5, price_target_currency: 'USD' } });
  const common = { country:'US', source:TradeDataSource.cbp_vessel_manifest,evidence_origin:EvidenceOrigin.fixture, retrieved_at:new Date(), source_provider:'CBP', license_type:'verification', allowed_to_display:false, allowed_to_export:false, allowed_to_cache:true, retention_limit:null, personal_data_flag:true };
  await prisma.importRecord.createMany({ data: [
    { ...common,source_record_id:`${marker}-1`,raw_consignee_string:'HANSEN HOME IMPORTS GMBH',hs_code:'630260',shipment_date:new Date('2026-06-01'),quantity:20,quantity_unit:'CTN',value:100,value_currency:'USD',origin_country:'IN',shipper_name:'Supplier A' },
    { ...common,source_record_id:`${marker}-2`,raw_consignee_string:'Hansen Home Imports G.m.b.H',hs_code:'630260',shipment_date:new Date('2026-07-01'),quantity:30,quantity_unit:'CTN',value:150,value_currency:'USD',origin_country:'CN',shipper_name:'Supplier B' },
    { ...common,source_record_id:`${marker}-3`,raw_consignee_string:'FAST FREIGHT FORWARDING LLC',hs_code:'630260',shipment_date:new Date('2026-07-02'),quantity:20,quantity_unit:'CTN' },
    { ...common,source_record_id:`${marker}-4`,raw_consignee_string:'BLOCKED TRADING LTD',hs_code:'630260',shipment_date:new Date('2026-07-03'),quantity:20,quantity_unit:'CTN' },
  ] });
  await prisma.sanctionsEntity.create({ data: { source:marker,source_record_id:`${marker}-sanction`,name:'Blocked Trading Limited',normalized_name:normalizeEntityName('Blocked Trading Limited'),observed_at:new Date(),evidence_origin:EvidenceOrigin.fixture } });
  const result = await runBuyerIntelligence({ exporter_org_id:org.id,product_id:product.id });
  check(result.resolved >= 4 && await prisma.importRecord.count({where:{source_record_id:{startsWith:marker},buyer_id:null}})===0, 'stage 1 resolves every in-scope source row');
  const variants = await prisma.importRecord.findMany({ where:{source_record_id:{in:[`${marker}-1`,`${marker}-2`]}},include:{buyer:{include:{attribute_claims:true}}} });
  check(variants[0].buyer_id === variants[1].buyer_id, 'duplicate legal suffix and punctuation variants resolve to one Buyer');
  check(variants[0].buyer!.attribute_claims.filter(claim=>claim.attribute==='name').length === 2 && variants[0].buyer!.attribute_claims.filter(claim=>claim.attribute==='country_code').length === 2, 'each resolved name and country claim retains source record and observation date');
  check(variants.every(row=>row.resolution_confidence && row.resolution_method), 'each match stores confidence and method');
  const broker = await prisma.buyer.findFirstOrThrow({where:{import_records:{some:{source_record_id:`${marker}-3`}}}});
  check(broker.deprioritized && JSON.stringify(broker.deprioritization_reasons).includes('intermediary'), 'stage 2 deprioritizes freight intermediaries');
  const hansen = variants[0].buyer!;
  const features = await prisma.buyerFeatureSnapshot.findUniqueOrThrow({where:{buyer_id:hansen.id}});
  check(features.shipment_count_12m===2 && features.typical_shipment_size?.toString()==='30' && features.india_sourcing_history===true, 'stage 3 computes shipment behaviour from licensed rows');
  check((features.origin_mix as Record<string,number>).IN===1 && features.supplier_concentration!=null, 'origin mix and supplier concentration are recorded');
  const fit = await prisma.buyerFitAssessment.findUniqueOrThrow({where:{buyer_id_product_id_exporter_org_id:{buyer_id:hansen.id,product_id:product.id,exporter_org_id:org.id}}});
  check(fit.score!=null && fit.confidence_score===50, 'stage 4 renormalizes available volume/price evidence and lowers confidence for missing cert/outcome evidence');
  check(!('fit_score' in hansen), 'fit is absent from the global Buyer row');
  const blocked = await prisma.buyer.findFirstOrThrow({where:{import_records:{some:{source_record_id:`${marker}-4`}}}});
  check(blocked.sanctions_blocked && JSON.stringify(blocked.risk_flags).includes('sanctions_hit'), 'stage 6 hard-blocks a sanctions match into risk_flags');
  check(await prisma.buyerFitAssessment.findFirst({where:{buyer_id:blocked.id}})===null, 'sanctions-blocked buyer is never scored or surfaced');
  const lead = await prisma.buyerLead.create({data:{exporter_org_id:org.id,product_id:product.id,buyer_id:hansen.id}});
  await prisma.$transaction(async tx=>{await recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.contacted,new Date('2026-08-01'),null,EvidenceOrigin.fixture);await recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.replied,new Date('2026-08-02'),null,EvidenceOrigin.fixture);await recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.converted,new Date('2026-08-03'),null,EvidenceOrigin.fixture);});
  const outcome=await prisma.buyerOutcome.findUniqueOrThrow({where:{buyer_lead_id:lead.id}});
  check(outcome.contacted_at!=null&&outcome.replied_at!=null&&outcome.converted===true,'stage 5 automatically accumulates lead outcomes');
  const exporter={id:'x',role:UserRole.exporter_owner,tier:OrgTier.paid,exporter_org_id:org.id} as Principal;
  check(!permits(exporter,'buyer_discovery.run')&&!permits(exporter,'buyer_lead.create'),'exporter self-service buyer discovery and lead creation are denied');
}
main().finally(()=>prisma.$disconnect());
