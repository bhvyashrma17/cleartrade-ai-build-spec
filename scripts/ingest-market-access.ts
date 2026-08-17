import { JobType } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
const arg=(name:string)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.split('=')[1];
async function main(){const country=(arg('country')??'').toUpperCase(),hs_code=arg('hs')??'';if(country!=='GB'||!/^\d{6}$/.test(hs_code))throw new Error('Usage: npm run ingest:market-access -- --country=GB --hs=090111');const job=await enqueueJob({type:JobType.market_access_ingest,payload:{country_code:country,hs_code},dedupe_key:`market-access:${country}:${hs_code}:${new Date().toISOString().slice(0,10)}`});console.log(JSON.stringify({job_id:job.id,country_code:country,hs_code}));}
main().finally(()=>prisma.$disconnect());
