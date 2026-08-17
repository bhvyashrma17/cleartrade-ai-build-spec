import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, EvidenceOrigin, MarketAccessEvidenceStatus, MarketAccessRuleType, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const BASE='https://www.trade-tariff.service.gov.uk/uk/api';
export const UK_TARIFF_AUTHORITY='HM Revenue & Customs — UK Integrated Online Tariff';
export const UK_TARIFF_PARSER_VERSION='uk-tariff-v1';
type Resource={id:string;type:string;attributes:Record<string,unknown>;relationships?:Record<string,{data:{id:string;type:string}|Array<{id:string;type:string}>|null}>};
type Document={data:Resource;included?:Resource[]};
const key=(r:{id:string;type:string})=>`${r.type}:${r.id}`;
async function getJson(url:string):Promise<Document>{const response=await fetch(url,{headers:{accept:'application/vnd.hmrc.2.0+json'}});if(!response.ok)throw new Error(`UK Trade Tariff returned ${response.status} for ${new URL(url).pathname}.`);return response.json() as Promise<Document>;}
const related=(r:Resource,name:string,index:Map<string,Resource>)=>{const data=r.relationships?.[name]?.data;return !data?[]:(Array.isArray(data)?data:[data]).map(x=>index.get(key(x))).filter((x):x is Resource=>Boolean(x));};
const rate=(value:unknown)=>{const match=String(value??'').match(/^\s*(-?\d+(?:\.\d+)?)\s*%\s*$/);return match?Number(match[1]):null;};

export async function ingestUkMarketAccessHs6(hs6:string,now=new Date(),sourceRunId?:string){
  if(!/^\d{6}$/.test(hs6))throw new Error('UK market-access ingest requires exact HS6.');
  const searchUrl=`${BASE}/search?q=${hs6}`,search=await getJson(searchUrl);
  const entry=(search.data.attributes.entry??null) as {endpoint?:string;id?:string}|null;
  if(!entry?.endpoint||!entry.id)throw new Error(`UK tariff has no exact entry for HS ${hs6}.`);
  const tree=await getJson(`${BASE}/${entry.endpoint}/${entry.id}`);
  const commodities=(tree.included??[]).filter(r=>r.type==='commodity'&&r.attributes.declarable===true&&String(r.attributes.goods_nomenclature_item_id).startsWith(hs6));
  if(!commodities.length)throw new Error(`UK tariff has no current declarable commodity beneath HS ${hs6}.`);
  const documents=await Promise.all(commodities.map(c=>getJson(`${BASE}/commodities/${c.attributes.goods_nomenclature_item_id}`)));
  const normalized:Array<Omit<Prisma.MarketAccessEvidenceCreateManyInput,'snapshot_id'>>=[];
  const ordinaryRates:number[]=[],indiaRates:number[]=[];let preferenceUnresolved=false,ordinaryUnresolved=false,regulatoryUnresolved=false;
  const rawSummaries:Prisma.InputJsonValue[]=[];
  for(const [position,document] of documents.entries()){
    const code=String(commodities[position].attributes.goods_nomenclature_item_id),resources=document.included??[],index=new Map(resources.map(r=>[key(r),r]));
    rawSummaries.push({commodity_code:code,sha256:createHash('sha256').update(JSON.stringify(document)).digest('hex'),response:document as unknown as Prisma.InputJsonValue});
    const measures=resources.filter(r=>r.type==='measure'&&r.attributes.import===true&&(!r.attributes.effective_end_date||new Date(String(r.attributes.effective_end_date))>now));
    const ordinary=measures.filter(m=>related(m,'measure_type',index)[0]?.id==='103').map(m=>({m,d:related(m,'duty_expression',index)[0]}));
    if(!ordinary.length)ordinaryUnresolved=true;
    for(const {d} of ordinary){const parsed=rate(d?.attributes.base);if(parsed==null)ordinaryUnresolved=true;else ordinaryRates.push(parsed);}
    const india=measures.filter(m=>related(m,'measure_type',index)[0]?.id==='142'&&related(m,'geographical_area',index)[0]?.id==='IN').map(m=>({m,d:related(m,'duty_expression',index)[0]}));
    if(!india.length)preferenceUnresolved=true;
    for(const {d} of india){const parsed=rate(d?.attributes.base);if(parsed==null)preferenceUnresolved=true;else indiaRates.push(parsed);}
    for(const measure of measures){
      const mt=related(measure,'measure_type',index)[0],conditions=related(measure,'measure_conditions',index);if(!mt||['103','142'].includes(mt.id))continue;
      const directGeo=related(measure,'geographical_area',index)[0]?.id,excluded=related(measure,'excluded_countries',index).some(g=>g.id==='IN');
      if(excluded)continue;
      if(!(directGeo==='1011'||directGeo==='IN')){
        if(directGeo&&/^[A-Z]{2}$/.test(directGeo))continue;
        if(String(mt.attributes.description).toLowerCase().includes('value added tax')||measure.attributes.excise===true||measure.attributes.vat===true)continue;
        regulatoryUnresolved=true;continue;
      }
      const allowed=conditions.some(c=>String(c.attributes.action).toLowerCase()==='import allowed'),denied=conditions.length>0&&conditions.every(c=>String(c.attributes.action).toLowerCase()==='import is not allowed');
      const documentsRequired=conditions.filter(c=>c.attributes.measure_condition_class==='document');
      if(denied&&!allowed)normalized.push({jurisdiction:'GB',country_code:'GB',hs_code_scope:code,rule_type:MarketAccessRuleType.import_prohibition,source_authority:UK_TARIFF_AUTHORITY,source_reference:`${BASE}/commodities/${code}#measure-${measure.id}`,retrieved_at:now,effective_at:new Date(String(measure.attributes.effective_start_date)),expires_at:measure.attributes.effective_end_date?new Date(String(measure.attributes.effective_end_date)):null,status:MarketAccessEvidenceStatus.verified,confidence:new Prisma.Decimal(1),raw_evidence:{measure_id:measure.id,measure_type:String(mt.attributes.description??'')}});
      for(const condition of documentsRequired)normalized.push({jurisdiction:'GB',country_code:'GB',hs_code_scope:code,rule_type:MarketAccessRuleType.mandatory_certification,source_authority:UK_TARIFF_AUTHORITY,source_reference:`${BASE}/commodities/${code}#condition-${condition.id}`,retrieved_at:now,effective_at:new Date(String(measure.attributes.effective_start_date)),expires_at:measure.attributes.effective_end_date?new Date(String(measure.attributes.effective_end_date)):null,status:MarketAccessEvidenceStatus.verified,confidence:new Prisma.Decimal(.95),requirement_code:String(condition.attributes.document_code||'')||null,requirement_description:String(condition.attributes.requirement||condition.attributes.certificate_description||mt.attributes.description),requirement_obtainable:null,raw_evidence:{measure_id:measure.id,condition_id:condition.id,action:String(condition.attributes.action??'')}});
      if(!documentsRequired.length&&!denied)normalized.push({jurisdiction:'GB',country_code:'GB',hs_code_scope:code,rule_type:MarketAccessRuleType.material_non_tariff_requirement,source_authority:UK_TARIFF_AUTHORITY,source_reference:`${BASE}/commodities/${code}#measure-${measure.id}`,retrieved_at:now,effective_at:new Date(String(measure.attributes.effective_start_date)),expires_at:measure.attributes.effective_end_date?new Date(String(measure.attributes.effective_end_date)):null,status:MarketAccessEvidenceStatus.verified,confidence:new Prisma.Decimal(.9),requirement_description:String(mt.attributes.description),raw_evidence:{measure_id:measure.id,measure_type_id:mt.id}});
    }
  }
  if(!ordinaryRates.length||ordinaryUnresolved)throw new Error('UK tariff response did not contain a parseable ordinary ad-valorem duty for every declarable scope.');
  normalized.push({jurisdiction:'GB',country_code:'GB',hs_code_scope:hs6,rule_type:MarketAccessRuleType.destination_tariff,source_authority:UK_TARIFF_AUTHORITY,source_reference:`${searchUrl}#third-country-duty`,retrieved_at:now,status:MarketAccessEvidenceStatus.verified,confidence:new Prisma.Decimal(1),tariff_rate_percent:new Prisma.Decimal(Math.max(...ordinaryRates)),raw_evidence:{aggregation:'maximum across declarable UK commodity lines',rates:ordinaryRates}});
  normalized.push({jurisdiction:'GB',country_code:'GB',hs_code_scope:hs6,rule_type:MarketAccessRuleType.preferential_tariff_india,source_authority:UK_TARIFF_AUTHORITY,source_reference:`${searchUrl}#india-preference`,retrieved_at:now,status:preferenceUnresolved?MarketAccessEvidenceStatus.needs_review:MarketAccessEvidenceStatus.verified,confidence:new Prisma.Decimal(preferenceUnresolved?.5:1),tariff_rate_percent:indiaRates.length?new Prisma.Decimal(Math.max(...indiaRates)):null,raw_evidence:{aggregation:'maximum direct India preference across declarable UK commodity lines',rates:indiaRates,unresolved:preferenceUnresolved}});
  const rawEvidence={commodity_count:commodities.length,regulatory_group_membership_unresolved:regulatoryUnresolved,responses:rawSummaries};
  const checksum=createHash('sha256').update(JSON.stringify(rawEvidence)).digest('hex');
  return prisma.$transaction(async tx=>{await tx.marketAccessEvidenceSnapshot.updateMany({where:{country_code:'GB',hs_code_scope:hs6,completeness_status:EvidenceCompletenessStatus.COMPLETE},data:{completeness_status:EvidenceCompletenessStatus.STALE,expires_at:now}});const snapshot=await tx.marketAccessEvidenceSnapshot.create({data:{jurisdiction:'GB',country_code:'GB',hs_code_scope:hs6,source_authority:UK_TARIFF_AUTHORITY,source_reference:searchUrl,retrieved_at:now,completeness_status:regulatoryUnresolved?EvidenceCompletenessStatus.PARTIAL:EvidenceCompletenessStatus.COMPLETE,tariff_coverage:true,regulatory_coverage:!regulatoryUnresolved,parser_version:UK_TARIFF_PARSER_VERSION,evidence_origin:EvidenceOrigin.public_real,provider:'HMRC',source_dataset:'UK Integrated Online Tariff v2',source_run_id:sourceRunId,raw_response_checksum:checksum,raw_evidence:rawEvidence}});await tx.marketAccessEvidence.createMany({data:normalized.map(e=>({...e,snapshot_id:snapshot.id,evidence_origin:EvidenceOrigin.public_real}))});return tx.marketAccessEvidenceSnapshot.findUniqueOrThrow({where:{id:snapshot.id},include:{evidence:true}});});
}
