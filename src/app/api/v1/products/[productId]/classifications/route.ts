import {ProductClassificationMethod,UserRole} from '@prisma/client';
import {NextResponse} from 'next/server';
import {z} from 'zod';
import {requirePrincipal} from '@/lib/auth';
import {errorResponse,newCorrelationId,notFound,single,validationError} from '@/lib/errors';
import {assertCan,assertOrgAccess} from '@/lib/permissions';
import {prisma} from '@/lib/prisma';
import {confirmClassification,proposeClassification} from '@/lib/product-classification';
import {zodFieldErrors} from '@/lib/validators';

const proposal=z.object({action:z.literal('propose'),itc_hs_code:z.string().regex(/^\d{8}$/).nullish(),hs6_code:z.string().regex(/^\d{6}$/).nullish(),nomenclature:z.enum(['HS','ITC-HS']),nomenclature_version:z.literal('2022'),method:z.nativeEnum(ProductClassificationMethod),evidence:z.record(z.unknown()),confidence:z.number().min(0).max(1),ambiguous:z.boolean().optional()});
const confirmation=z.object({action:z.literal('confirm'),classification_id:z.string().min(1)});
const inputSchema=z.discriminatedUnion('action',[proposal,confirmation]);

async function context(productId:string){const principal=await requirePrincipal(),product=await prisma.product.findUnique({where:{id:productId}});if(!product)throw notFound('That product is not available.');await assertOrgAccess(principal,product.exporter_org_id);assertCan(principal,'exporter_master_data.edit');return {principal};}

export async function GET(_request:Request,ctx:{params:Promise<{productId:string}>}){const correlationId=newCorrelationId();try{const {productId}=await ctx.params;await context(productId);const rows=await prisma.productClassification.findMany({where:{product_id:productId},include:{proposed_by:{select:{id:true,name:true,role:true}},confirmed_by:{select:{id:true,name:true,role:true}}},orderBy:{revision:'desc'}});return NextResponse.json(single(rows),{headers:{'x-correlation-id':correlationId}});}catch(error){return errorResponse(error,correlationId);}}

export async function POST(request:Request,ctx:{params:Promise<{productId:string}>}){
  const correlationId=newCorrelationId();
  try{
    const {productId}=await ctx.params,{principal}=await context(productId),parsed=inputSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)throw validationError(zodFieldErrors(parsed.error));
    if(parsed.data.action==='confirm'){const row=await confirmClassification({classification_id:parsed.data.classification_id,product_id:productId},principal,correlationId);return NextResponse.json(single(row),{headers:{'x-correlation-id':correlationId}});}
    const exporter=[UserRole.exporter_owner,UserRole.exporter_member] as readonly UserRole[];if(exporter.includes(principal.role)&&parsed.data.method!==ProductClassificationMethod.exporter_supplied)throw validationError([{field:'method',code:'invalid',message:'Exporter submissions must retain exporter-supplied provenance.'}]);
    const row=await proposeClassification({product_id:productId,...parsed.data},principal,correlationId);return NextResponse.json(single(row),{status:201,headers:{'x-correlation-id':correlationId}});
  }catch(error){return errorResponse(error,correlationId);}
}
