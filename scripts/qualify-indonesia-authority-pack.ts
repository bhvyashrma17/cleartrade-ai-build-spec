import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { buildIndonesiaAuthorityBundle, readIndonesiaAuthorityBundle, type IndonesiaBundleArtifact } from '@/lib/market-access/providers/indonesia-bundle';
import { INDONESIA_PINNED_ARTIFACTS } from '@/lib/market-access/providers/indonesia-acquisition';
import { INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST } from '@/lib/market-access/providers/indonesia-remedies';

const ROOT=path.resolve(process.cwd(),'.artifacts/customs-atlas/indonesia');
const RELEASE='2026-09-21';
const AUTHORITY='Kementerian Keuangan Republik Indonesia';
const bpk=(id:number,slug:string)=>`https://peraturan.bpk.go.id/Details/${id}/${slug}`;
const publicationDates:Record<string,string>={
  '15_PMK.010_2022.pdf':'2022-02-22','40_PMK.010_2022.pdf':'2022-03-30','176_PMK.010_2022.pdf':'2022-12-02','2023pmkeuangan032.pdf':'2023-03-27',
  '2024pmkeuangan060.pdf':'2024-09-17','2024pmkeuangan066.pdf':'2024-10-04','2024pmkeuangan070.pdf':'2024-10-14','2024pmkeuangan071.pdf':'2024-10-18',
  '95_th_2024.pdf':'2024-12-16','2026pmkeuangan031.pdf':'2026-05-12','2025pmkeuangan009.pdf':'2025-02-10','21_th_2025.pdf':'2025-03-11',
  '2026pmkeuangan014.pdf':'2026-04-01','2026pmkeuangan032.pdf':'2026-05-12','2026pmkeuangan040.pdf':'2026-06-11','2023pmkeuangan151.pdf':'2023-12-28',
  '2024pmkeuangan048.pdf':'2024-08-06','2024pmkeuangan049.pdf':'2024-07-26','2025pmkeuangan014.pdf':'2025-02-18','29_Tahun_2025.pdf':'2025-05-14',
  '67_th_2025.pdf':'2025-10-20','2025pmkeuangan098.pdf':'2025-12-31','2026pmkeuangan036.pdf':'2026-05-21','2026pmkeuangan037.pdf':'2026-05-21',
};

const core:Omit<IndonesiaBundleArtifact,'bytes'>[]=[
  {name:'26_PMK.010_2022.pdf',role:'mfn_baseline',url:bpk(215104,'pmk-no-26pmk0102022'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'26/PMK.010/2022',instrument_title:'Classification system and import duty schedule',publication_date:'2022-03-30',effective_from:'2022-04-01'},
  {name:'2024pmkeuangan010.pdf',role:'mfn_first_amendment',url:bpk(279874,'pmk-no-10-tahun-2024'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'PMK 10/2024',instrument_title:'First amendment to PMK 26/2022',publication_date:'2024-02-15',effective_from:'2024-02-15'},
  {name:'2025pmkeuangan062.pdf',role:'mfn_second_amendment',url:'https://repository.beacukai.go.id/peraturan/2025/09/b820287ca6d3360ec464b68c14415011-pmk-62-tahun-2025.pdf',issuing_authority:AUTHORITY,publication_repository:'JDIH DJBC',instrument_number:'PMK 62/2025',instrument_title:'Second amendment to PMK 26/2022',publication_date:'2025-09-08',effective_from:'2025-09-15'},
  {name:'2026pmkeuangan050.pdf',role:'mfn_third_amendment_current_snapshot',url:bpk(352102,'pmk-no-50-tahun-2026'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'PMK 50/2026',instrument_title:'Third amendment to PMK 26/2022',publication_date:'2026-07-21',effective_from:'2026-07-28'},
  {name:'47_PMK.010_2022.pdf',role:'aifta_base_schedule',url:bpk(215303,'pmk-no-47pmk0102022'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'47/PMK.010/2022',instrument_title:'AIFTA import duty schedule',publication_date:'2022-03-30',effective_from:'2022-04-01'},
  {name:'92_PMK.010_2022.pdf',role:'aifta_line_amendment',url:bpk(216282,'pmk-no-92pmk0102022'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'92/PMK.010/2022',instrument_title:'Amendment of AIFTA line 9031.20.00',publication_date:'2022-06-02',effective_from:'2022-06-02'},
  {name:'2023pmkeuangan035.pdf',role:'aifta_origin_documentation',url:bpk(246539,'pmk-no-35'),issuing_authority:AUTHORITY,publication_repository:'JDIH BPK',instrument_number:'PMK 35/2023',instrument_title:'Procedures for preferential tariff origin evidence',publication_date:'2023-03-29',effective_from:'2023-04-28'},
];

async function main(){
  const remedies=INDONESIA_ACTIVE_TRADE_REMEDY_MANIFEST.remedies.map((item):Omit<IndonesiaBundleArtifact,'bytes'>=>({
    name:item.artifact_name,role:`active_${item.kind.toLowerCase()}`,url:item.source_url,issuing_authority:item.issuing_authority,
    publication_repository:item.publication_repository,instrument_number:[item.instrument,...item.amended_instruments].join(' as amended by '),
    instrument_title:item.product,publication_date:publicationDates[item.artifact_name]!,effective_from:item.effective_from,
  }));
  const definitions=[...core,...remedies];
  if(definitions.length!==31||new Set(definitions.map((item)=>item.name)).size!==31)throw new Error(`Expected 31 unique official PDF artifacts; found ${definitions.length}.`);
  const artifacts:IndonesiaBundleArtifact[]=[];
  for(const definition of definitions){
    const bytes=await fs.readFile(path.join(ROOT,definition.name));const pin=INDONESIA_PINNED_ARTIFACTS[definition.name as keyof typeof INDONESIA_PINNED_ARTIFACTS];
    const checksum=createHash('sha256').update(bytes).digest('hex');if(!pin||pin.bytes!==bytes.length||pin.sha256!==checksum)throw new Error(`${definition.name} does not match the pinned artifact identity.`);
    artifacts.push({...definition,bytes});
  }
  const bytes=await buildIndonesiaAuthorityBundle({release_identifier:RELEASE,source_url:core[0]!.url,artifacts});
  const bundle=await readIndonesiaAuthorityBundle({bytes,release_identifier:RELEASE});
  const zip=await JSZip.loadAsync(bytes);
  const detailedOperations=JSON.parse(await zip.file('mfn-amendment-diff.json')!.async('text')) as Array<{operation:string}>;
  const operationCounts=Object.fromEntries(['ADD','DELETE','REPLACE','CORRECTION'].map((operation)=>[operation,detailedOperations.filter((item)=>item.operation===operation).length]));
  const out=path.join(ROOT,'indonesia-authority-bundle.zip');await fs.writeFile(out,bytes);
  console.log(JSON.stringify({status:'LOCAL_QUALIFIED_STAGING_PENDING',release_identifier:RELEASE,official_pdf_artifacts:artifacts.length,bundle_artifacts:bundle.files.length,
    bundle_bytes:bytes.length,bundle_sha256:bundle.checksum,mfn_rows:bundle.mfn.size,aifta_unique_codes:bundle.aifta.size,aifta_schedule_entries:bundle.aifta_schedule_entries,
    anti_dumping:bundle.remedies.remedies.filter((item)=>item.kind==='ANTI_DUMPING').length,safeguards:bundle.remedies.remedies.filter((item)=>item.kind==='SAFEGUARD').length,
    amendment_replay:{chain:bundle.amendment_operations,detailed_operation_count:detailedOperations.length,by_operation:operationCounts},output:out},null,2));
}

void main();
