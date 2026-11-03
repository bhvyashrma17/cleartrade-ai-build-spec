import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { activeAuthorityRelease, AUTHORITY_RELEASE_IMPORT_PRINCIPALS, importAuthorityRelease, loadAuthorityReleaseArtifact, type AuthorityReleaseSource } from '@/lib/market-access/authority-releases';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireIndonesiaAuthorityBundle } from './indonesia-acquisition';
import { INDONESIA_BUNDLE_READER_VERSION, IndonesiaBundleError, readIndonesiaAuthorityBundle, readIndonesiaAuthorityRelease, type IndonesiaAuthorityBundle, type IndonesiaBundleArtifact } from './indonesia-bundle';
import { buildIndonesiaMarketAccess, INDONESIA_PARSER_VERSION, INDONESIA_SOURCE_AUTHORITY } from './indonesia-parser';
import type { IndonesiaTradeRemedyManifest } from './indonesia-remedies';

export const INDONESIA_SOURCE_FAMILY = 'ID_KEMENKEU_BTKI' as const;
export const INDONESIA_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: INDONESIA_SOURCE_FAMILY,
  authority: INDONESIA_SOURCE_AUTHORITY,
  destination_scope: ['ID'],
  source_distribution: 'Official JDIH BPK legal artifacts: BTKI 2022 MFN chain, AIFTA schedule/origin instrument, and complete active anti-dumping/safeguard manifest at 2026-09-21',
  source_format: 'zip+pdf+json',
  content_type: 'application/zip',
  max_bundle_bytes: 160 * 1024 * 1024,
  reader_version: INDONESIA_BUNDLE_READER_VERSION,
  parser_version: INDONESIA_PARSER_VERSION,
});

export async function importIndonesiaRelease(args: { actor: Principal; bytes: Buffer; release_identifier: string; reference_date: Date; source_url: string; activate?: boolean; correlation_id: string; retrieved_at?: Date }) {
  return importAuthorityRelease({ ...args, source: INDONESIA_RELEASE_SOURCE,
    label: `Indonesia BTKI/AIFTA/remedies — ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: IndonesiaAuthorityBundle;
      try { bundle=await readIndonesiaAuthorityBundle({bytes,release_identifier:args.release_identifier.trim()}); }
      catch(error){if(error instanceof IndonesiaBundleError)throw validationError([{field:'bundle',code:error.code,message:error.message}]);throw error;}
      return { file_manifest:bundle.files,validation:{
        exact_layout_checked:true,per_file_sha256_validated:true,
        mfn_row_count:bundle.mfn.size,aifta_unique_code_count:bundle.aifta.size,aifta_schedule_entry_count:bundle.aifta_schedule_entries,
        ordered_mfn_chain:['PMK 26/2022','PMK 10/2024','PMK 62/2025','PMK 50/2026'],
        aifta_amendment_applied:'PMK 92/2022 replaces 9031.20.00 with product-variant rates',
        india_origin_proof_required:true,active_anti_dumping_count:bundle.remedies.remedies.filter((item)=>item.kind==='ANTI_DUMPING').length,
        active_safeguard_count:bundle.remedies.remedies.filter((item)=>item.kind==='SAFEGUARD').length,
        remedy_manifest_complete_as_of:bundle.remedies.complete_as_of,producer_identity_enforced:true,
        safeguard_origin_exemptions_enforced:true,tariff_treatment_complete:true,regulatory_coverage_complete:false,
      }};
    },
  });
}

export async function acquireAndImportIndonesiaRelease(args: Omit<Parameters<typeof importIndonesiaRelease>[0],'bytes'|'source_url'> & {
  sources:readonly Omit<IndonesiaBundleArtifact,'bytes'>[]; remedies?:IndonesiaTradeRemedyManifest; fetch_impl?:typeof fetch;
}) {
  const bytes=await acquireIndonesiaAuthorityBundle({release_identifier:args.release_identifier,sources:args.sources,remedies:args.remedies,fetch_impl:args.fetch_impl});
  return importIndonesiaRelease({...args,bytes,source_url:args.sources[0]?.url??'https://peraturan.bpk.go.id/Details/215104/pmk-no-26pmk0102022'});
}

export function activeIndonesiaRelease(){return activeAuthorityRelease(INDONESIA_SOURCE_FAMILY,INDONESIA_SOURCE_AUTHORITY);}
const bundleCache=new SharedBudgetBundleCache<IndonesiaAuthorityBundle>(INDONESIA_SOURCE_FAMILY,192*1024*1024);

async function loadIndonesiaBundle(releaseId?:string){
  const release=releaseId?(await loadAuthorityReleaseArtifact(releaseId)).release:await activeIndonesiaRelease();
  if(!release)throw validationError([{field:'release',code:'missing',message:'No official Indonesia BTKI authority release has been imported and activated.'}]);
  if(release.source_family!==INDONESIA_SOURCE_FAMILY||release.authority!==INDONESIA_SOURCE_AUTHORITY)throw validationError([{field:'release',code:'wrong_authority',message:'That release is not an Indonesia BTKI authority release.'}]);
  const cached=bundleCache.get(release.checksum);if(cached)return{release,bundle:cached};
  const loaded=await loadAuthorityReleaseArtifact(release.id);const bundle=await readIndonesiaAuthorityRelease({bytes:loaded.bytes,release_identifier:release.release_identifier,reader_version:release.reader_version});
  if(bundle.checksum!==release.checksum)throw new Error(`Decoded Indonesia bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum,bundle);return{release,bundle};
}

export async function fetchIndonesiaMarketAccess(hs6:string,options:{now?:Date;origin_country?:string;producer_or_exporter?:string;parser_version?:string;release_id?:string}={}){
  if(!/^\d{6}$/.test(hs6))throw validationError([{field:'hs6',code:'invalid',message:'Indonesia Market Access requires an exact six-digit HS code.'}]);
  const loaded=await loadIndonesiaBundle(options.release_id);
  return buildIndonesiaMarketAccess({bundle:loaded.bundle,release_id:loaded.release.id,release_reference_date:loaded.release.reference_date,retrieved_at:loaded.release.retrieved_at,
    hs6,at:options.now??new Date(),origin_country:options.origin_country,producer_or_exporter:options.producer_or_exporter,parser_version:options.parser_version??loaded.release.parser_version});
}

export async function reparseIndonesiaAuthorityRelease(args:{actor:Principal;release_id:string;hs6:string;parser_version:string;now?:Date;origin_country?:string;producer_or_exporter?:string;correlation_id:string}){
  if(!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole))throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  assertCan(args.actor,'demand_discovery.run');
  const result=await fetchIndonesiaMarketAccess(args.hs6,{release_id:args.release_id,parser_version:args.parser_version,now:args.now,origin_country:args.origin_country,producer_or_exporter:args.producer_or_exporter});
  const snapshot=await persistMarketAccessIngest(result,{source_run_id:`authority-reparse:${args.release_id}:${args.parser_version}`});
  await writeAuditEvent({actor:args.actor,action:AUDIT_ACTIONS.generate,object_type:'market_access_authority_reparse',object_id:snapshot.id,exporter_org_id:null,
    after_summary:{authority_release_id:args.release_id,parser_version:args.parser_version,hs6:args.hs6,snapshot_id:snapshot.id},correlation_id:args.correlation_id});
  return snapshot;
}

export const __test__={bundleCache};
