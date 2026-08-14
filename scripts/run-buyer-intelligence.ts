import { JobStatus, JobType } from '@prisma/client';
import { registerAllJobHandlers } from '@/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

function arg(name: string) { return process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3); }
async function main() {
  const exporter_org_id=arg('exporter-org'); const product_id=arg('product');
  if(!exporter_org_id||!product_id) throw new Error('Usage: npm run buyers:build -- --exporter-org=<id> --product=<id>');
  registerAllJobHandlers();
  const job=await enqueueJob({type:JobType.buyer_intelligence,payload:{exporter_org_id,product_id},dedupe_key:`buyer_intelligence:${exporter_org_id}:${product_id}:${new Date().toISOString().slice(0,10)}`});
  while(await prisma.job.count({where:{type:JobType.buyer_intelligence,status:JobStatus.queued}})) { const claimed=await claimNextJob([JobType.buyer_intelligence]); if(!claimed) continue; await runClaimedJob(claimed); }
  console.log(JSON.stringify(await prisma.job.findUnique({where:{id:job.id},select:{id:true,status:true,result:true}}),null,2));
}
main().finally(()=>prisma.$disconnect());
