import { NextResponse,type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { requestCountryTruthDiscovery } from '@/lib/country-truth-discovery-request';
import { errorResponse,newCorrelationId,single,validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const requestSchema=z.object({product_id:z.string().min(1),candidate_countries:z.array(z.string().trim().min(1)).min(1).max(3)});

export async function POST(request:NextRequest,ctx:{params:Promise<{exporterOrgId:string}>}){
  const correlationId=newCorrelationId();
  try{
    const actor=await requirePrincipal(),body=await request.json().catch(()=>null),parsed=requestSchema.safeParse(body);
    if(!parsed.success)throw validationError(zodFieldErrors(parsed.error));
    const {exporterOrgId}=await ctx.params;
    const result=await requestCountryTruthDiscovery({actor,exporter_org_id:exporterOrgId,product_id:parsed.data.product_id,candidate_countries:parsed.data.candidate_countries,correlation_id:correlationId});
    return NextResponse.json(single({job_id:result.job.id,status:result.job.status,selected_countries:result.payload.candidates,product:{id:result.payload.product_id,classification:{id:result.payload.product_classification_id,hs6:result.payload.hs6,hs_revision:result.payload.hs_revision}},duplicate:!result.created}),{status:202,headers:{'x-correlation-id':correlationId}});
  }catch(error){return errorResponse(error,correlationId);}
}
