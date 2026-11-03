import { randomUUID } from 'node:crypto';
import { JobStatus,JobType,OrgTier,ProductClassificationMethod,ProductClassificationStatus,UserRole } from '@prisma/client';
import { afterAll,describe,expect,test,vi } from 'vitest';

const {requirePrincipalMock}=vi.hoisted(()=>({requirePrincipalMock:vi.fn()}));
vi.mock('@/lib/auth',()=>({requirePrincipal:requirePrincipalMock}));

import { POST } from '../src/app/api/v1/exporters/[exporterOrgId]/country-truth-discovery/route';
import { requestCountryTruthDiscovery } from '../src/lib/country-truth-discovery-request';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(()=>prisma.$disconnect());

const principal=(id:string,role:UserRole):Principal=>({id,email:`${id}@cleartrade.test`,name:role,role,exporter_org_id:null,tier:OrgTier.paid});

async function fixture(options:{classificationStatus?:ProductClassificationStatus;newerCandidate?:boolean}={}){
  const suffix=randomUUID().slice(0,8);
  const [org,otherOrg]=await Promise.all([
    prisma.exporterOrg.create({data:{display_name:`Country Truth ${suffix}`,tier:OrgTier.paid}}),
    prisma.exporterOrg.create({data:{display_name:`Other ${suffix}`,tier:OrgTier.paid}}),
  ]);
  const [agent,otherAgent,admin]=await Promise.all([
    prisma.user.create({data:{email:`ct-agent-${suffix}@test.local`,name:'Assigned Agent',role:UserRole.agent}}),
    prisma.user.create({data:{email:`ct-other-${suffix}@test.local`,name:'Other Agent',role:UserRole.agent}}),
    prisma.user.create({data:{email:`ct-admin-${suffix}@test.local`,name:'Admin',role:UserRole.admin}}),
  ]);
  await prisma.agentAssignment.create({data:{exporter_org_id:org.id,agent_user_id:agent.id,status:'active'}});
  const product=await prisma.product.create({data:{exporter_org_id:org.id,name:`Basmati ${suffix}`}});
  const status=options.classificationStatus??ProductClassificationStatus.confirmed,now=new Date('2026-08-24T12:00:00.000Z');
  const classification=await prisma.productClassification.create({data:{product_id:product.id,revision:1,itc_hs_code:'10063012',hs6_code:'100630',nomenclature:'ITC-HS',nomenclature_version:'2022',method:ProductClassificationMethod.manually_verified,product_facts_snapshot:{name:product.name},evidence:{source:'test'},rationale:'Verified against the current tariff catalogue.',source_references:[],confidence:.99,status,proposed_by_id:agent.id,...(status===ProductClassificationStatus.confirmed?{confirmed_by_id:agent.id,confirmed_at:now}:{})}});
  await prisma.product.update({where:{id:product.id},data:{hs_classification_revision:options.newerCandidate?2:1,...(status===ProductClassificationStatus.confirmed?{itc_hs_code:'10063012',hs_code:'100630',hs_nomenclature:'ITC-HS',hs_nomenclature_version:'2022',hs_classification_method:ProductClassificationMethod.manually_verified,hs_classification_status:ProductClassificationStatus.confirmed,hs_classification_confidence:.99,hs_confirmed_by_id:agent.id,hs_confirmed_at:now}:{})}});
  if(options.newerCandidate)await prisma.productClassification.create({data:{product_id:product.id,revision:2,itc_hs_code:'10063019',hs6_code:'100630',nomenclature:'ITC-HS',nomenclature_version:'2022',method:ProductClassificationMethod.agent_supplied,product_facts_snapshot:{name:product.name},evidence:{source:'test-newer'},rationale:'Newer candidate awaiting resolution.',source_references:[],confidence:.9,status:ProductClassificationStatus.candidate,proposed_by_id:agent.id}});
  return{org,otherOrg,product,classification,agent:principal(agent.id,UserRole.agent),otherAgent:principal(otherAgent.id,UserRole.agent),admin:principal(admin.id,UserRole.admin)};
}

const request=(productId:string,countries=['Germany','UAE','USA'])=>new Request('http://localhost/api/v1/exporters/org/country-truth-discovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product_id:productId,candidate_countries:countries})});

describe('Agent Country Truth enqueue endpoint',()=>{
  test('an assigned Agent enqueues one frozen job and audit event without external IO',async()=>{
    const f=await fixture(),fetchSpy=vi.spyOn(globalThis,'fetch');requirePrincipalMock.mockResolvedValue(f.agent);
    const response=await POST(request(f.product.id) as never,{params:Promise.resolve({exporterOrgId:f.org.id})});
    expect(response.status).toBe(202);
    const body=await response.json();
    expect(body.data).toMatchObject({status:'queued',selected_countries:[{country_code:'DE',reporter_code:'276'},{country_code:'AE',reporter_code:'784'},{country_code:'US',reporter_code:'842'}],product:{id:f.product.id,classification:{id:f.classification.id,hs6:'100630',hs_revision:'2022'}},duplicate:false});
    const job=await prisma.job.findUniqueOrThrow({where:{id:body.data.job_id}});
    expect(job).toMatchObject({type:JobType.country_truth_discovery,status:JobStatus.queued,exporter_org_id:f.org.id,requested_by_id:f.agent.id,target_type:'product_classification',target_id:f.classification.id});
    expect(job.payload).toMatchObject({schema_version:'country-truth-discovery-job-v3',exporter_org_id:f.org.id,product_id:f.product.id,product_classification_id:f.classification.id,hs6:'100630',hs_revision:'2022',requested_by_agent_id:f.agent.id,policies:{country_evidence:{policy_version:'country-evidence-acquisition-v1'},country_trade_metrics:{policy_version:'country-trade-metrics-v1',calculation_version:'country-trade-calculator-v1'},country_truth_scoring:{model_version:'market-attractiveness-v4',formula_version:'country-truth-scoring-v4'},country_truth_phase_1h:{policy_version:'country-truth-phase-1h-v4',calculation_version:'country-truth-phase-1h-v4'}}});
    expect(await prisma.auditEvent.findFirst({where:{object_type:'country_truth_job',object_id:job.id,actor_user_id:f.agent.id,exporter_org_id:f.org.id}})).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('an unassigned Agent is rejected without revealing the exporter',async()=>{
    const f=await fixture();requirePrincipalMock.mockResolvedValue(f.otherAgent);
    const response=await POST(request(f.product.id) as never,{params:Promise.resolve({exporterOrgId:f.org.id})});
    expect(response.status).toBe(404);expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  test('a product from another exporter is rejected',async()=>{
    const f=await fixture(),otherProduct=await prisma.product.create({data:{exporter_org_id:f.otherOrg.id,name:'Other product'}});requirePrincipalMock.mockResolvedValue(f.agent);
    const response=await POST(request(otherProduct.id) as never,{params:Promise.resolve({exporterOrgId:f.org.id})});
    expect(response.status).toBe(404);expect((await response.json()).error.code).toBe('NOT_FOUND');
  });

  test('a product without classification history is rejected',async()=>{
    const f=await fixture(),product=await prisma.product.create({data:{exporter_org_id:f.org.id,name:'Unclassified product'}});
    await expect(requestCountryTruthDiscovery({actor:f.agent,exporter_org_id:f.org.id,product_id:product.id,candidate_countries:['DE'],correlation_id:randomUUID()})).rejects.toMatchObject({code:'VALIDATION_ERROR',fields:[expect.objectContaining({code:'classification_required'})]});
  });

  test.each([ProductClassificationStatus.candidate,ProductClassificationStatus.superseded])('rejects a product whose only classification is %s',async status=>{
    const f=await fixture({classificationStatus:status});
    await expect(requestCountryTruthDiscovery({actor:f.agent,exporter_org_id:f.org.id,product_id:f.product.id,candidate_countries:['DE'],correlation_id:randomUUID()})).rejects.toMatchObject({code:'VALIDATION_ERROR'});
  });

  test('rejects a confirmed classification when a newer candidate is unresolved',async()=>{
    const f=await fixture({newerCandidate:true});
    await expect(requestCountryTruthDiscovery({actor:f.agent,exporter_org_id:f.org.id,product_id:f.product.id,candidate_countries:['DE'],correlation_id:randomUUID()})).rejects.toMatchObject({code:'VALIDATION_ERROR',fields:[expect.objectContaining({code:'classification_stale'})]});
  });

  test('maps app country identifiers and deduplicates an identical active request',async()=>{
    const f=await fixture(),args={actor:f.agent,exporter_org_id:f.org.id,product_id:f.product.id,candidate_countries:['DEU','United Arab Emirates','US'],correlation_id:randomUUID(),requested_at:new Date('2026-08-24T12:30:00.000Z')};
    const first=await requestCountryTruthDiscovery(args),second=await requestCountryTruthDiscovery({...args,correlation_id:randomUUID(),candidate_countries:['USA','Germany','UAE']});
    expect(first.created).toBe(true);expect(second.created).toBe(false);expect(second.job.id).toBe(first.job.id);
    expect(first.payload.candidates.map(item=>item.reporter_code)).toEqual(['276','784','842']);
    expect(await prisma.job.count({where:{type:JobType.country_truth_discovery,dedupe_key:first.job.dedupe_key}})).toBe(1);
  });

  test('authorized Admin may enqueue without an Agent assignment',async()=>{
    const f=await fixture();
    await expect(requestCountryTruthDiscovery({actor:f.admin,exporter_org_id:f.org.id,product_id:f.product.id,candidate_countries:['Germany'],correlation_id:randomUUID()})).resolves.toMatchObject({created:true});
  });
});
