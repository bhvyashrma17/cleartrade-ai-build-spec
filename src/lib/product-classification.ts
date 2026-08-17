import {Prisma,ProductClassificationMethod,ProductClassificationStatus,UserRole} from '@prisma/client';
import {AUDIT_ACTIONS,writeAuditEvent} from '@/lib/audit';
import {prisma} from '@/lib/prisma';
import type {Principal} from '@/types';

export const SUPPORTED_NOMENCLATURES={HS:['2022'],'ITC-HS':['2022']} as const;
export function projectHs6(input:{itc_hs_code?:string|null;hs6_code?:string|null;nomenclature:string;nomenclature_version:string}){
  if(!(input.nomenclature in SUPPORTED_NOMENCLATURES)||!(SUPPORTED_NOMENCLATURES[input.nomenclature as keyof typeof SUPPORTED_NOMENCLATURES] as readonly string[]).includes(input.nomenclature_version))throw new Error('Unknown or unsupported nomenclature/version.');
  if(input.itc_hs_code!=null&&!/^\d{8}$/.test(input.itc_hs_code))throw new Error('ITC-HS codes must contain exactly eight digits.');
  if(input.hs6_code!=null&&!/^\d{6}$/.test(input.hs6_code))throw new Error('HS6 codes must contain exactly six digits.');
  if(input.nomenclature==='ITC-HS'&&!input.itc_hs_code)throw new Error('An ITC-HS classification requires the original eight-digit code.');
  const projected=input.itc_hs_code?.slice(0,6)??input.hs6_code;if(!projected)throw new Error('An HS6 or ITC-HS code is required.');
  if(input.hs6_code&&input.hs6_code!==projected)throw new Error('The supplied HS6 projection does not match the ITC-HS code.');return projected;
}

export async function proposeClassification(input:{product_id:string;itc_hs_code?:string|null;hs6_code?:string|null;nomenclature:string;nomenclature_version:string;method:ProductClassificationMethod;evidence:unknown;confidence:number;ambiguous?:boolean},actor:Principal,correlationId:string){
  if(input.confidence<0||input.confidence>1||!Number.isFinite(input.confidence))throw new Error('Classification confidence must be between zero and one.');
  const hs6=projectHs6(input),product=await prisma.product.findUniqueOrThrow({where:{id:input.product_id}});const isAi=input.method===ProductClassificationMethod.ai_assisted_candidate,status=input.ambiguous||isAi||input.confidence<.85?ProductClassificationStatus.needs_review:ProductClassificationStatus.candidate;
  return prisma.$transaction(async tx=>{const revision=product.hs_classification_revision+1;const candidate=await tx.productClassification.create({data:{product_id:product.id,revision,itc_hs_code:input.itc_hs_code,hs6_code:hs6,nomenclature:input.nomenclature,nomenclature_version:input.nomenclature_version,method:input.method,evidence:input.evidence as Prisma.InputJsonValue,confidence:input.confidence,status,proposed_by_id:actor.id}});await tx.product.update({where:{id:product.id},data:{hs_classification_revision:revision}});await writeAuditEvent({db:tx,actor,action:AUDIT_ACTIONS.update,object_type:'product_classification',object_id:candidate.id,exporter_org_id:product.exporter_org_id,before_summary:{},after_summary:{revision,hs6_code:hs6,status,method:input.method},correlation_id:correlationId});return candidate;});
}

export async function confirmClassification(input:{classification_id:string;product_id?:string},actor:Principal,correlationId:string){
  const candidate=await prisma.productClassification.findUniqueOrThrow({where:{id:input.classification_id},include:{product:true}});const staff=[UserRole.agent,UserRole.ops_supervisor,UserRole.admin] as readonly UserRole[];if(candidate.status===ProductClassificationStatus.needs_review&&!staff.includes(actor.role))throw new Error('Ambiguous or AI-assisted classifications require agent/compliance review.');
  if(input.product_id&&candidate.product_id!==input.product_id)throw new Error('Classification does not belong to the requested product.');
  return prisma.$transaction(async tx=>{
    const now=new Date(),previousCode=candidate.product.hs_code;
    await tx.productClassification.updateMany({where:{product_id:candidate.product_id,status:ProductClassificationStatus.confirmed},data:{status:ProductClassificationStatus.superseded,superseded_at:now}});
    const confirmed=await tx.productClassification.update({where:{id:candidate.id},data:{status:ProductClassificationStatus.confirmed,confirmed_by_id:actor.id,confirmed_at:now}});
    await tx.product.update({where:{id:candidate.product_id},data:{itc_hs_code:candidate.itc_hs_code,hs_code:candidate.hs6_code,hs_code_source:candidate.method,hs_nomenclature:candidate.nomenclature,hs_nomenclature_version:candidate.nomenclature_version,hs_classification_method:candidate.method,hs_classification_status:ProductClassificationStatus.confirmed,hs_classification_confidence:candidate.confidence,hs_classification_evidence:candidate.evidence as Prisma.InputJsonValue,hs_confirmed_by_id:actor.id,hs_confirmed_at:now}});
    if(previousCode&&previousCode!==candidate.hs6_code)await tx.marketAssessment.updateMany({where:{product_id:candidate.product_id,classification_current:true},data:{classification_current:false,classification_invalidated_at:now,classification_invalidation_reason:`Product classification changed from ${previousCode} to ${candidate.hs6_code}; recommendation requires recomputation.`}});
    await writeAuditEvent({db:tx,actor,action:AUDIT_ACTIONS.update,object_type:'product_classification',object_id:candidate.id,exporter_org_id:candidate.product.exporter_org_id,before_summary:{hs6_code:previousCode,status:candidate.product.hs_classification_status},after_summary:{hs6_code:candidate.hs6_code,status:'confirmed',revision:candidate.revision},correlation_id:correlationId});return confirmed;
  });
}
