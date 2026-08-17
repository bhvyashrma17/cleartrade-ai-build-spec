import {SanctionsReviewDecisionValue,UserRole} from '@prisma/client';
import {NextResponse} from 'next/server';
import {requirePrincipal} from '@/lib/auth';
import {errorResponse,forbidden,newCorrelationId,single,validationError} from '@/lib/errors';
import {recordSanctionsReview} from '@/lib/sanctions/screening';

export async function POST(request:Request){const correlationId=newCorrelationId();try{const principal=await requirePrincipal();if(!([UserRole.ops_supervisor,UserRole.admin] as readonly UserRole[]).includes(principal.role))throw forbidden('Only Ops supervisors and administrators may decide sanctions reviews.');const body=await request.json() as {case_id?:string;decision?:string;reason?:string;evidence?:unknown};if(!body.case_id||!body.reason||!Object.values(SanctionsReviewDecisionValue).includes(body.decision as SanctionsReviewDecisionValue))throw validationError([{field:'body',code:'invalid',message:'case_id, a valid decision, and reason are required.'}]);const decision=await recordSanctionsReview({case_id:body.case_id,reviewer_user_id:principal.id,decision:body.decision as SanctionsReviewDecisionValue,reason:body.reason,evidence:body.evidence});return NextResponse.json(single(decision),{status:201,headers:{'x-correlation-id':correlationId}});}catch(error){return errorResponse(error,correlationId);}}
