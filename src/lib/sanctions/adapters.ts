export type {SanctionsSource} from './sources';
import type {SanctionsSource} from './sources';
export type ParsedSanctionsEntity={source_record_id:string;primary_name:string;aliases:string[];entity_type:string|null;countries:string[];addresses:string[];dates:string[];identifiers:{type:string|null;value:string}[];programs:string[];remarks:string|null;source_published_at:Date|null;source_version:string|null;raw:Record<string,string>};
export type ParseResult={
  /** Record blocks found in the artifact. */
  retrieved_count:number;
  entities:ParsedSanctionsEntity[];
  rejected_records:number;
  parse_errors:string[];
  source_update_date:Date|null;
  source_version:string|null;
  /**
   * Count the AUTHORITY itself declares in the artifact, when it publishes one (OFAC does
   * via <Record_Count>). This is the strongest completeness signal available: it lets the
   * gate reconcile what we parsed against what the publisher says exists, rather than
   * trusting our own block-counting regex. Null when the source publishes no such number.
   */
  authoritative_record_count:number|null;
};

const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').trim();
const values=(xml:string,tag:string)=>[...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(m=>decode(m[1].replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim()).filter(Boolean);
const attr=(xml:string,name:string)=>[...xml.matchAll(new RegExp(`\\b${name}="([^"]+)"`,'gi'))].map(m=>decode(m[1])).filter(Boolean);
const blocks=(xml:string,tag:string)=>[...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(m=>m[0]);
const unique=(xs:string[])=>[...new Set(xs.map(x=>x.trim()).filter(Boolean))];
const date=(value?:string)=>{if(!value)return null;const parsed=new Date(value);return Number.isNaN(parsed.getTime())?null:parsed;};

export function parseOfac(xml:string):ParseResult{
  const records=blocks(xml,'sdnEntry'),entities:ParsedSanctionsEntity[]=[],errors:string[]=[];let rejected=0;
  for(const record of records){const primaryRecord=record.replace(/<akaList\b[\s\S]*?<\/akaList>/gi,'').replace(/<addressList\b[\s\S]*?<\/addressList>/gi,'').replace(/<idList\b[\s\S]*?<\/idList>/gi,'');const id=values(primaryRecord,'uid')[0];const name=unique([...values(primaryRecord,'firstName'),...values(primaryRecord,'lastName')]).join(' ');if(!id||!name){rejected++;if(errors.length<20)errors.push(`OFAC record missing ${!id?'uid':'name'}`);continue;}
    const aliases=blocks(record,'aka').map(a=>unique([...values(a,'firstName'),...values(a,'lastName')]).join(' ')).filter(Boolean);
    const addresses=blocks(record,'address').map(a=>unique(['address1','address2','address3','city','stateOrProvince','postalCode','country'].flatMap(t=>values(a,t))).join(', ')).filter(Boolean);
    const identifiers=blocks(record,'id').map(i=>({type:values(i,'idType')[0]??null,value:values(i,'idNumber')[0]??''})).filter(i=>i.value);
    entities.push({source_record_id:id,primary_name:name,aliases:unique(aliases),entity_type:values(record,'sdnType')[0]??null,countries:unique([...values(record,'nationality'),...values(record,'country')]),addresses:unique(addresses),dates:unique([...values(record,'dateOfBirth'),...values(record,'yearOfBirth')]),identifiers,programs:unique(values(record,'program')),remarks:values(record,'remarks')[0]??null,source_published_at:null,source_version:null,raw:{uid:id}});
  }
  // OFAC publishes its own header block. `publshInformation` is OFAC's spelling, not a
  // typo here. Publish_Date is MM/DD/YYYY. Record_Count is authoritative.
  const header=blocks(xml,'publshInformation')[0]??'';
  const publishDate=values(header,'Publish_Date')[0]??null;
  const declared=Number(values(header,'Record_Count')[0]??'');
  const published=publishDate?(()=>{const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(publishDate);return m?new Date(Date.UTC(+m[3],+m[1]-1,+m[2])):date(publishDate);})():null;
  return {retrieved_count:records.length,entities,rejected_records:rejected,parse_errors:errors,source_update_date:published,source_version:publishDate,authoritative_record_count:Number.isFinite(declared)&&declared>0?declared:null};
}

export function parseUn(xml:string):ParseResult{
  const records=[...blocks(xml,'INDIVIDUAL'),...blocks(xml,'ENTITY')],entities:ParsedSanctionsEntity[]=[],errors:string[]=[];let rejected=0;
  for(const record of records){const id=values(record,'DATAID')[0];const person=/<INDIVIDUAL\b/i.test(record);const name=unique(['FIRST_NAME','SECOND_NAME','THIRD_NAME','FOURTH_NAME'].flatMap(t=>values(record,t))).join(' ');if(!id||!name){rejected++;if(errors.length<20)errors.push(`UN record missing ${!id?'DATAID':'name'}`);continue;}
    const addresses=blocks(record,'INDIVIDUAL_ADDRESS').concat(blocks(record,'ENTITY_ADDRESS')).map(a=>unique(['STREET','CITY','STATE_PROVINCE','ZIP_CODE','COUNTRY'].flatMap(t=>values(a,t))).join(', ')).filter(Boolean);
    const identifiers=blocks(record,'INDIVIDUAL_DOCUMENT').map(i=>({type:values(i,'TYPE_OF_DOCUMENT')[0]??null,value:values(i,'NUMBER')[0]??''})).filter(i=>i.value);
    entities.push({source_record_id:id,primary_name:name,aliases:unique(values(record,'ALIAS_NAME')),entity_type:person?'person':'entity',countries:unique([...values(record,'NATIONALITY'),...values(record,'COUNTRY')]),addresses:unique(addresses),dates:unique([...values(record,'DATE'),...values(record,'YEAR')]),identifiers,programs:unique(values(record,'UN_LIST_TYPE')),remarks:values(record,'COMMENTS1')[0]??null,source_published_at:date(values(record,'LISTED_ON')[0]),source_version:null,raw:{data_id:id}});
  }
  // The live schema carries `dateGenerated` as a root ATTRIBUTE. The previous adapter read
  // a `<CONSOLIDATED_LIST_DATE>` ELEMENT, which does not exist in the published artifact —
  // so publication date and version were always null, defeating freshness evaluation.
  const generated=attr(xml.slice(0,2000),'dateGenerated')[0]??null;
  return {retrieved_count:records.length,entities,rejected_records:rejected,parse_errors:errors,source_update_date:date(generated),source_version:generated,authoritative_record_count:null};
}

export function parseEu(xml:string):ParseResult{
  const records=blocks(xml,'sanctionEntity'),entities:ParsedSanctionsEntity[]=[],errors:string[]=[];let rejected=0;
  for(const record of records){const id=attr(record,'euReferenceNumber')[0]??attr(record,'logicalId')[0];const name=attr(record,'wholeName')[0]??values(record,'wholeName')[0];if(!id||!name){rejected++;if(errors.length<20)errors.push(`EU record missing ${!id?'identifier':'name'}`);continue;}
    const allNames=unique(attr(record,'wholeName'));const addresses=blocks(record,'address').map(a=>unique(['street','city','zipCode','countryDescription'].flatMap(n=>attr(a,n))).join(', ')).filter(Boolean);
    const identifiers=[...record.matchAll(/<identification\b([^>]*)\/?>(?:[\s\S]*?<\/identification>)?/gi)].map(match=>({type:attr(match[1],'identificationTypeCode')[0]??null,value:attr(match[1],'number')[0]??''})).filter(i=>i.value);
    entities.push({source_record_id:id,primary_name:name,aliases:allNames.filter(n=>n!==name),entity_type:attr(record,'subjectType')[0]??attr(record,'classificationCode')[0]??null,countries:unique([...attr(record,'countryDescription'),...attr(record,'countryIso2Code')]),addresses:unique(addresses),dates:unique([...attr(record,'birthdate'),...attr(record,'year')]),identifiers,programs:unique([...attr(record,'programme'),...attr(record,'regulationProgramme')]),remarks:attr(record,'remark')[0]??values(record,'remark')[0]??null,source_published_at:date(attr(record,'publicationDate')[0]),source_version:null,raw:{eu_reference_number:id}});
  }
  // generationDate + globalFileId live on the root <export> element. globalFileId is the
  // provider's own version identifier and is the more stable version signal of the two.
  const head=xml.slice(0,2000);
  const update=attr(head,'generationDate')[0]??attr(head,'dateOfIssue')[0];
  const fileId=attr(head,'globalFileId')[0]??null;
  return {retrieved_count:records.length,entities,rejected_records:rejected,parse_errors:errors,source_update_date:date(update),source_version:fileId?`globalFileId:${fileId}`:(update??null),authoritative_record_count:null};
}

// The OFAC Consolidated (non-SDN) artifact uses the IDENTICAL <sdnList> schema as SDN, so
// it reuses the SDN adapter deliberately — one parser, two datasets, separate snapshots.
export const SANCTIONS_ADAPTERS={ofac_sdn:parseOfac,ofac_non_sdn_consolidated:parseOfac,un_security_council:parseUn,eu_financial_sanctions:parseEu} satisfies Record<SanctionsSource,(xml:string)=>ParseResult>;
