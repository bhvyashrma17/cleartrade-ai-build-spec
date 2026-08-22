/** Guarded, one-product Country Evidence planner. Dry-run is the default. */
import { getConfigWithVersion } from '../src/lib/config';
import { appEnvironment } from '../src/lib/evidence-environment';
import { buildCountryEvidencePlan } from '../src/lib/country-evidence/planner';
import { createCountryEvidencePlan, executeCountryEvidencePlan } from '../src/lib/country-evidence/service';
import { prisma } from '../src/lib/prisma';
import { requireCountryTruthClassification } from '../src/lib/product-classification';

function arg(name:string){return process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);}
function flag(name:string){return process.argv.includes(`--${name}`);}

async function main(){
  const classificationId=arg('classification-id'),candidateText=arg('candidates'),asOfText=arg('as-of');
  if(!classificationId||!candidateText||!asOfText)throw new Error('Usage: npm run plan:country-evidence -- --classification-id=<id> --candidates=842,276 --as-of=2026-08-22 [--execute] [--allow-partial]');
  const candidates=candidateText.split(',').map(value=>value.trim()).filter(Boolean);
  if(candidates.length<1||candidates.length>10)throw new Error('The guarded planner accepts 1–10 explicit candidate reporters.');
  const asOf=new Date(`${asOfText}T00:00:00.000Z`);if(Number.isNaN(asOf.getTime()))throw new Error('--as-of must be YYYY-MM-DD.');
  const classification=await requireCountryTruthClassification(classificationId);
  const configured=await getConfigWithVersion('country_evidence.policy');
  const mode=(process.env.COMTRADE_CLIENT==='real'?'authenticated':process.env.COMTRADE_CLIENT==='preview'?'preview':process.env.COMTRADE_CLIENT==='fixture'?'fixture':'mock') as 'authenticated'|'preview'|'fixture'|'mock';
  const planned=buildCountryEvidencePlan({product_classification_id:classification.id,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,as_of_date:asOf,candidate_reporters:candidates,source_mode:mode,policy:configured.value,policy_config_version:configured.version});
  const summary={dry_run:!flag('execute'),environment:appEnvironment(),source_mode:mode,plan_key:planned.plan_key,hs_code:classification.hs6_code,hs_revision:classification.nomenclature_version,latest_common_year:planned.latest_common_year,period_set:planned.period_set,candidate_reporters:planned.candidate_reporters,estimated_calls:planned.items.length,items:planned.items.map(({item_key,purpose,reporter_code,partner_scope,period,priority})=>({item_key,purpose,reporter_code,partner_scope,period,priority}))};
  if(!flag('execute')){console.log(JSON.stringify(summary,null,2));return;}
  if(appEnvironment()==='production')throw new Error('This guarded one-product tool refuses production execution.');
  if((appEnvironment()==='staging'||mode==='authenticated')&&!flag('confirm-live-acquisition'))throw new Error('Live acquisition requires --confirm-live-acquisition.');
  const persisted=await createCountryEvidencePlan({product_classification_id:classification.id,as_of_date:asOf,candidate_reporters:candidates,source_mode:mode});
  const result=await executeCountryEvidencePlan(persisted.id,{allow_partial_execution:flag('allow-partial')});
  console.log(JSON.stringify({...summary,dry_run:false,plan_id:persisted.id,result},null,2));
}

main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}).finally(()=>prisma.$disconnect());
