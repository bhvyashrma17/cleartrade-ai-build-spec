import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { BuyerLeadStage, EvidenceOrigin, OrgTier, TradeDataSource, UserRole } from '@prisma/client';
import { normalizeEntityName, runBuyerIntelligence } from '../src/lib/buyer-intelligence';
import { createBuyerOutcomeForLead, recordBuyerOutcomeTransition, recordBuyerPaymentEvidence } from '../src/lib/buyer-outcomes';
import { canReadDeal, canSearchBuyers, permits } from '../src/lib/permissions';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

const marker=`vitest-buyer-${randomUUID()}`;
afterAll(async()=>{await prisma.importRecord.deleteMany({where:{source_record_id:{startsWith:marker}}});await prisma.sanctionsEntity.deleteMany({where:{source:marker}});await prisma.sanctionsSourceSnapshot.deleteMany({where:{source:marker}});await prisma.exporterOrg.deleteMany({where:{display_name:{startsWith:marker}}});await prisma.buyer.deleteMany({where:{legal_name:{contains:marker}}});await prisma.user.deleteMany({where:{email:{startsWith:marker}}});await prisma.$disconnect();});

describe('buyer intelligence',()=>{
  test('normalizes punctuation and legal suffix variants',()=>expect(normalizeEntityName('Hansen Home Imports G.m.b.H')).toBe(normalizeEntityName('HANSEN HOME IMPORTS GMBH')));

  test('merges duplicate spellings, preserves claims, filters intermediaries and sanctions, and keeps fit contextual',async()=>{
    const org=await prisma.exporterOrg.create({data:{display_name:marker,tier:OrgTier.paid}});
    const product=await prisma.product.create({data:{exporter_org_id:org.id,name:'Towels',hs_code:'630260',evidence_origin:EvidenceOrigin.fixture,capacity_value:100,capacity_unit:'CTN',moq_value:10,moq_unit:'CTN',price_target_amount:5,price_target_currency:'USD'}});
    const common={country:'US',source:TradeDataSource.cbp_vessel_manifest,evidence_origin:EvidenceOrigin.fixture,retrieved_at:new Date(),source_provider:'fixture',license_type:'test',allowed_to_display:false,allowed_to_export:false,allowed_to_cache:true,retention_limit:null,personal_data_flag:true,shipment_date:new Date(),hs_code:'630260',quantity:20,quantity_unit:'CTN',value:100,value_currency:'USD'};
    await prisma.importRecord.createMany({data:[
      {...common,buyer_ref:`${marker}-hansen`,source_record_id:`${marker}-1`,raw_consignee_string:`${marker} HANSEN HOME IMPORTS GMBH`},
      {...common,buyer_ref:`${marker}-hansen`,source_record_id:`${marker}-2`,raw_consignee_string:`${marker} Hansen Home Imports G.m.b.H`},
      {...common,buyer_ref:`${marker}-freight`,source_record_id:`${marker}-3`,raw_consignee_string:`${marker} FAST FREIGHT FORWARDING LLC`},
      {...common,buyer_ref:`${marker}-blocked`,source_record_id:`${marker}-4`,raw_consignee_string:`${marker} BLOCKED TRADING LTD`},
    ]});
    // Screening only reads entities reachable through an ACTIVE snapshot (atomic activation),
    // so the fixture mirrors the production shape: an activated snapshot owning its entities.
    // Binding it is what makes this entity screenable; an unbound entity is correctly ignored.
    const sanctionsSnapshot=await prisma.sanctionsSourceSnapshot.create({data:{source:marker,source_url:'fixture',checksum:'fixture',record_count:1,retrieved_count:1,parsed_entity_count:1,completeness_status:'COMPLETE',coverage_complete:true,state:'active',activated_at:new Date(),last_successful_full_refresh:new Date(),evidence_origin:EvidenceOrigin.fixture}});
    await prisma.sanctionsEntity.create({data:{snapshot_id:sanctionsSnapshot.id,source:marker,source_record_id:`${marker}-s`,name:`${marker} BLOCKED TRADING`,normalized_name:normalizeEntityName(`${marker} BLOCKED TRADING`),observed_at:new Date(),evidence_origin:EvidenceOrigin.fixture}});
    await runBuyerIntelligence({exporter_org_id:org.id,product_id:product.id});
    const rows=await prisma.importRecord.findMany({where:{source_record_id:{startsWith:marker}},include:{buyer:{include:{attribute_claims:true}}}});
    const variants=rows.filter(r=>r.source_record_id.endsWith('-1')||r.source_record_id.endsWith('-2'));
    expect(variants[0].buyer_id).toBe(variants[1].buyer_id);
    expect(variants[0].buyer!.attribute_claims.filter(c=>c.attribute==='buyer_ref')).toHaveLength(2);
    const broker=rows.find(r=>r.source_record_id.endsWith('-3'))!.buyer!;expect(broker.deprioritized).toBe(true);
    const blocked=rows.find(r=>r.source_record_id.endsWith('-4'))!.buyer!;expect(blocked.sanctions_blocked).toBe(true);expect(await prisma.buyerFitAssessment.findFirst({where:{buyer_id:blocked.id}})).toBeNull();
    const buyer=variants[0].buyer!;const fit=await prisma.buyerFitAssessment.findFirstOrThrow({where:{buyer_id:buyer.id,product_id:product.id,exporter_org_id:org.id}});
    expect(fit.score).not.toBeNull();expect(fit.evidence_origins).toEqual([EvidenceOrigin.fixture]);expect('fit_score' in buyer).toBe(false);
  });

  test('BuyerLead creates one contextual outcome and transitions accumulate on it',async()=>{
    const org=await prisma.exporterOrg.create({data:{display_name:`${marker}-outcome`,tier:OrgTier.paid}});
    const product=await prisma.product.create({data:{exporter_org_id:org.id,name:'Outcome product',evidence_origin:EvidenceOrigin.fixture}});
    const buyer=await prisma.buyer.create({data:{legal_name:`${marker} outcome buyer`,display_name:'Outcome buyer',country_code:'US',buyer_type:'importer'}});
    const lead=await prisma.buyerLead.create({data:{exporter_org_id:org.id,product_id:product.id,buyer_id:buyer.id}});
    await prisma.$transaction(tx=>createBuyerOutcomeForLead(tx,lead,EvidenceOrigin.fixture));
    await prisma.$transaction(tx=>recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.contacted,new Date('2026-01-01'),null,EvidenceOrigin.fixture));
    await prisma.$transaction(tx=>recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.replied,new Date('2026-01-02'),null,EvidenceOrigin.fixture));
    const outcome=await prisma.buyerOutcome.findUniqueOrThrow({where:{buyer_lead_id:lead.id}});
    expect(outcome).toMatchObject({evidence_origin:EvidenceOrigin.fixture});expect(outcome.contacted_at).not.toBeNull();expect(outcome.replied_at).not.toBeNull();expect(await prisma.buyerOutcome.count({where:{buyer_lead_id:lead.id}})).toBe(1);
  });

  test('freezes fit context, preserves multiple attempts and links conversion/payment evidence',async()=>{
    const org=await prisma.exporterOrg.create({data:{display_name:`${marker}-instrumented`,tier:OrgTier.paid}});
    const actor=await prisma.user.create({data:{email:`${marker}@example.invalid`,name:'Agent',role:UserRole.agent}});
    const product=await prisma.product.create({data:{exporter_org_id:org.id,name:'Instrumented product',evidence_origin:EvidenceOrigin.fixture,moq_value:12,moq_unit:'CTN'}});
    const buyer=await prisma.buyer.create({data:{legal_name:`${marker} instrumented buyer`,display_name:'Instrumented buyer',country_code:'US',buyer_type:'importer'}});
    const fit=await prisma.buyerFitAssessment.create({data:{buyer_id:buyer.id,product_id:product.id,exporter_org_id:org.id,score:74,confidence_score:61,components:{volume_fit:80},input_snapshot:{shipment_count:4},model_version:'fit-v1',evidence_origins:[EvidenceOrigin.fixture]}});
    const lead=await prisma.buyerLead.create({data:{exporter_org_id:org.id,product_id:product.id,buyer_id:buyer.id,created_by_id:actor.id}});
    const snapshot=await prisma.buyerLeadSnapshot.create({data:{buyer_lead_id:lead.id,exporter_org_id:org.id,product_id:product.id,buyer_id:buyer.id,destination_country:'US',buyer_fit_assessment_id:fit.id,fit_model_version:fit.model_version,fit_score:fit.score,fit_confidence:fit.confidence_score,fit_components:{volume_fit:80},fit_input_snapshot:{shipment_count:4},buyer_rank:3,buyer_evidence_coverage:{sources:['fixture']},moq_value:product.moq_value,moq_unit:product.moq_unit}});
    await prisma.buyerFitAssessment.update({where:{id:fit.id},data:{score:10,model_version:'fit-v2'}});
    expect(await prisma.buyerLeadSnapshot.findUniqueOrThrow({where:{buyer_lead_id:lead.id}})).toMatchObject({id:snapshot.id,fit_score:74,fit_model_version:'fit-v1',buyer_rank:3});
    await expect(prisma.buyerLeadSnapshot.update({where:{id:snapshot.id},data:{fit_score:99}})).rejects.toThrow(/immutable/i);
    await prisma.outreachAttempt.createMany({data:[
      {buyer_lead_id:lead.id,actor_user_id:actor.id,channel:'email',sequence_number:1,delivery_status:'delivered',evidence_origin:EvidenceOrigin.fixture},
      {buyer_lead_id:lead.id,actor_user_id:actor.id,channel:'call',sequence_number:2,reply_classification:'positive_interest',replied_at:new Date(),evidence_origin:EvidenceOrigin.fixture},
    ]});
    expect(await prisma.outreachAttempt.count({where:{buyer_lead_id:lead.id}})).toBe(2);
    await prisma.$transaction(tx=>createBuyerOutcomeForLead(tx,lead,EvidenceOrigin.fixture));
    const deal=await prisma.deal.create({data:{exporter_org_id:org.id,buyer_id:buyer.id,product_id:product.id,buyer_lead_id:lead.id}});
    await prisma.$transaction(tx=>recordBuyerOutcomeTransition(tx,lead,BuyerLeadStage.converted,new Date(),null,EvidenceOrigin.fixture,actor.id,deal.id));
    const payment=await prisma.payment.create({data:{deal_id:deal.id,amount:100,currency:'USD',amount_received:100,status:'realized',source:'bank_partner',realized_at:new Date()}});
    await prisma.$transaction(tx=>recordBuyerPaymentEvidence(tx,deal.id,payment));
    const outcome=await prisma.buyerOutcome.findUniqueOrThrow({where:{buyer_lead_id:lead.id}});
    expect(outcome).toMatchObject({deal_id:deal.id,payment_behavior:'payment_realized',evidence_origin:EvidenceOrigin.fixture});
    expect(await prisma.buyerLeadTransition.count({where:{buyer_lead_id:lead.id,to_stage:BuyerLeadStage.converted}})).toBe(1);
  });
});

describe('agent-only and tenant restrictions',()=>{
  const exporter=(org:string):Principal=>({id:'exporter',email:'e@test',name:'E',role:UserRole.exporter_owner,exporter_org_id:org,tier:OrgTier.paid});
  test('exporters cannot run buyer discovery, and own-org reads are tenant scoped',async()=>{
    expect(permits(exporter('org-a'),'buyer_discovery.run')).toBe(false);
    expect(await canSearchBuyers(exporter('org-a'),{exporter_org_id:'org-a'})).toBe(false);
    expect(await canReadDeal(exporter('org-a'),{exporter_org_id:'org-a'})).toBe(true);
    expect(await canReadDeal(exporter('org-a'),{exporter_org_id:'org-b'})).toBe(false);
  });
});
