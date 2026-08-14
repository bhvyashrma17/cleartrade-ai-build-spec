import { JobType, JobStatus } from '@prisma/client';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
async function main(){registerAllJobHandlers();const day=new Date().toISOString().slice(0,10);const job=await enqueueJob({type:JobType.sanctions_ingest,payload:{scheduled_for:day},dedupe_key:`sanctions_ingest:${day}`});while(true){const claimed=await claimNextJob([JobType.sanctions_ingest]);if(claimed)await runClaimedJob({id:claimed.id,type:claimed.type,attempt_no:claimed.attempt_no,payload:claimed.payload,exporter_org_id:claimed.exporter_org_id,target_id:claimed.target_id,correlation_id:claimed.correlation_id});if(await prisma.job.count({where:{type:JobType.sanctions_ingest,status:JobStatus.queued}})===0)break;}console.log(await prisma.job.findUnique({where:{id:job.id},select:{id:true,status:true,result:true}}));}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
