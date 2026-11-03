import { createHash } from 'node:crypto';
import { buildIndonesiaAuthorityBundle, type IndonesiaBundleArtifact } from './indonesia-bundle';
import type { IndonesiaTradeRemedyManifest } from './indonesia-remedies';

export const INDONESIA_SOURCE_PRECEDENCE_VERSION = 'id-government-mirror-precedence-v1' as const;
export const INDONESIA_BASE_URL = 'https://peraturan.bpk.go.id/Download/209374/26_PMK.010_2022.pdf' as const;
export const INDONESIA_PMK62_URL = 'https://repository.beacukai.go.id/peraturan/2025/09/b820287ca6d3360ec464b68c14415011-pmk-62-tahun-2025.pdf' as const;
export const INDONESIA_PMK50_URL = 'https://peraturan.bpk.go.id/Download/415909/2026pmkeuangan050.pdf' as const;
export const INDONESIA_SAMPLE_REMEDY_URL = 'https://peraturan.bpk.go.id/Download/410515/2026pmkeuangan014.pdf' as const;
export const INDONESIA_RIGHTS_URL = 'https://peraturan.bpk.go.id/Details/38690/uu-no-28-tahun-2014' as const;
export const INDONESIA_KEMENKEU_PROVENANCE_URL = 'https://jdih.kemenkeu.go.id/dok/pmk-50-tahun-2026' as const;

export const INDONESIA_PINNED_ARTIFACTS = Object.freeze({
  '15_PMK.010_2022.pdf': { bytes: 1_000_762, sha256: 'a24a769d876c2ea174297ba0c480006dbc63957deba6c637c215b516a1bf2183' },
  '176_PMK.010_2022.pdf': { bytes: 736_807, sha256: '183f1a9ac8deed77e706035f221c2e2fa3788a4784c9495ed7cb6753b687dae8' },
  '2023pmkeuangan032.pdf': { bytes: 108_828, sha256: '0d76ec26277e4413ab9f5e78deca4deb7c8c3f238ab6510abb82e64fb74f8a46' },
  '2023pmkeuangan035.pdf': { bytes: 321_984, sha256: 'e0a8583ff0271969721142083de89ff6af6ff312dddbb0a67a5adb1a3807c166' },
  '2023pmkeuangan151.pdf': { bytes: 2_470_242, sha256: '3ce2bf1a563159f61776148e4f1f6eb4e723f685efe14fc42b23b4e6cace7160' },
  '2024pmkeuangan010.pdf': { bytes: 1_569_433, sha256: 'a36855733651c6af89e7bb5db79bfde9586705d63c24fffe175e3f1e7a1263e2' },
  '2024pmkeuangan048.pdf': { bytes: 1_239_648, sha256: 'd8ea0b24aa63a259f9ce2cfd8897d5918ae8c4bbec06d3d58a6fc5b5b1eb32f8' },
  '2024pmkeuangan049.pdf': { bytes: 732_494, sha256: '11eea0075256050a7ba3a4c9db7339b51ed05ae1ca9c735657c69fa6b0d624a9' },
  '2024pmkeuangan060.pdf': { bytes: 448_387, sha256: '03ebd5f739c724044ba23762fa359da960fdbac5753a07a6bdea861f74e2cf7d' },
  '2024pmkeuangan066.pdf': { bytes: 405_318, sha256: '26d850ed6aa8c398602de2a89bf1d3d0546f8c21bf611b3af05655c14c1a868d' },
  '2024pmkeuangan070.pdf': { bytes: 457_721, sha256: '779ef6b39e6a014a07b2911bae5b125984eef3b3814e1db059ab96a343fab3d8' },
  '2024pmkeuangan071.pdf': { bytes: 1_393_951, sha256: '615321c4365d4a9ea8d19aebf100fccc30257028c06d7eb375e8c4d34db06be3' },
  '2025pmkeuangan009.pdf': { bytes: 411_876, sha256: 'f11d0b129e351042736e617d850dcf72b48ababe4093eda8f630b9dde96cd36c' },
  '2025pmkeuangan014.pdf': { bytes: 522_258, sha256: 'c4898bd30c1c2aed13b6fc2493a986c1fa1b5d00300bb3b196f1ea1a1f953ea2' },
  '26_PMK.010_2022.pdf': { bytes: 26_345_564, sha256: 'ae0caa3d9f49fbdd3378af0ff4cbf84350cfe29f28ef767d07e2a063bf5e1fd6' },
  '2025pmkeuangan062.pdf': { bytes: 27_359_743, sha256: '87b58a44df61e2f78dfa950294043659b7b747305b08f21a16e9130a0ed8022b' },
  '2026pmkeuangan050.pdf': { bytes: 5_304_237, sha256: '31d89a89d01af2e90da1e06d9a75a84f5eaede6fa59123fbec973e018b1e940f' },
  '2026pmkeuangan014.pdf': { bytes: 783_898, sha256: '5c0f40b18a3b6d926d40c13951fc7d023ed4c01288b5e7747a1fd23ef7a87ae1' },
  '2025pmkeuangan098.pdf': { bytes: 1_283_379, sha256: '21253eeeab1bb69a2768bb861f0377aba5e7154a5eb08a78dd39701461ea949a' },
  '2026pmkeuangan031.pdf': { bytes: 1_585_994, sha256: '95aaf36e8439b22f8a4082d68f8a6b887a98da57966b8198a23974b9e9e67386' },
  '2026pmkeuangan032.pdf': { bytes: 1_599_969, sha256: '52852bccc7bae30343ee76ca0f169800d1c58c3a0177059cb6accf432b556719' },
  '2026pmkeuangan036.pdf': { bytes: 1_515_199, sha256: '97faa09bd53c6c9db8e1d96ec5716b54a244b2324b9520b0ae7fdb35ac6bc077' },
  '2026pmkeuangan037.pdf': { bytes: 1_637_518, sha256: '8c1f1b0f1e8091aff3dfb7649b2a6dae3db0c41afbb3b57900d4cfaf8958ef82' },
  '2026pmkeuangan040.pdf': { bytes: 1_796_440, sha256: 'c7dbcb66aa3ccc01106a8a62a45268b27f265c23077a4ca8be3d00dd13433239' },
  '21_th_2025.pdf': { bytes: 418_695, sha256: 'c7afb64c64f70a6dbc36c4184961a28c66ab67d84fdf692113ff4ca504bf1699' },
  '29_Tahun_2025.pdf': { bytes: 1_377_705, sha256: '2fe70ccca5b038979216da4e2d7e11d466a0fa15831dfc7905e7ec5e9e9f60dd' },
  '40_PMK.010_2022.pdf': { bytes: 1_588_284, sha256: '8548404e77d9a41598cf726ebfcff05a863e8237f5d1cf708784c6ecb8ee60c1' },
  '47_PMK.010_2022.pdf': { bytes: 23_568_414, sha256: '7c9e56634097c228f7a4db3d5ebd21ee577f8fb38127b286cf2e51f9186a5dc6' },
  '67_th_2025.pdf': { bytes: 1_524_712, sha256: '3ad09e4a73001258c870020add86a890f7ff1a5d78b18d7867821c575f6d26dc' },
  '92_PMK.010_2022.pdf': { bytes: 1_301_117, sha256: 'd75ca1fba7bdb23e334f6eaa36292e5a671434568ba6c9a6f00d6196c3baf92a' },
  '95_th_2024.pdf': { bytes: 398_177, sha256: '9ed0fcf2d9d643287eb3f8bbb5d02f11edad4a4573c300480ae96502fd1f17eb' },
} as const);

const ALLOWED_HOSTS = new Set(['peraturan.bpk.go.id','jdih.kemenkeu.go.id','repository.beacukai.go.id','peraturan.go.id']);
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function indonesiaOfficialUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) throw new Error(`Indonesia acquisition rejects non-government host ${url.hostname}.`);
  return url.toString();
}

export async function acquireIndonesiaOfficialPdf(args: { url: string; expected_sha256?: string; expected_bytes?: number; fetch_impl?: typeof fetch; attempts?: number }) {
  const fetchImpl=args.fetch_impl??fetch; const attempts=args.attempts??3; let last:unknown;
  for(let attempt=1;attempt<=attempts;attempt+=1){
    try{
      const response=await fetchImpl(indonesiaOfficialUrl(args.url),{redirect:'follow',signal:AbortSignal.timeout(90_000),headers:{accept:'application/pdf','user-agent':'ClearTrade-Customs-Atlas/1.0',connection:'close'}});
      if(!response.ok){if(response.status<500&&response.status!==429)throw new Error(`non-retryable HTTP ${response.status}`);throw new Error(`retryable HTTP ${response.status}`);}
      if(response.url&&!ALLOWED_HOSTS.has(new URL(response.url).hostname))throw new Error(`redirect outside official allowlist: ${response.url}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length<100||bytes.length>MAX_PDF_BYTES||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error(`invalid PDF bytes (${bytes.length})`);
      if(args.expected_bytes!==undefined&&bytes.length!==args.expected_bytes)throw new Error(`artifact length changed: ${bytes.length}`);
      const checksum=sha256(bytes); if(args.expected_sha256&&checksum!==args.expected_sha256)throw new Error(`artifact SHA-256 changed: ${checksum}`);
      return {bytes,size_bytes:bytes.length,sha256:checksum};
    }catch(error){last=error;if(attempt===attempts||/non-retryable|outside official|invalid PDF|changed/.test(String(error)))break;await new Promise((resolve)=>setTimeout(resolve,attempt*500));}
  }
  throw new Error(`Indonesia official acquisition failed for ${args.url}: ${last instanceof Error?last.message:String(last)}`,{cause:last});
}

/**
 * Sequential by design. Callers pass the reviewed, pinned v1 artifact list; changing repository
 * or URL is a release-identity change and requires a source-precedence version bump.
 */
export async function acquireIndonesiaAuthorityBundle(args: { release_identifier:string; sources:readonly Omit<IndonesiaBundleArtifact,'bytes'>[]; remedies?:IndonesiaTradeRemedyManifest; fetch_impl?:typeof fetch }) {
  const artifacts:IndonesiaBundleArtifact[]=[];
  for(const source of args.sources){
    const pin=INDONESIA_PINNED_ARTIFACTS[source.name as keyof typeof INDONESIA_PINNED_ARTIFACTS];
    if(!pin)throw new Error(`Indonesia source ${source.name} is not part of the pinned ${INDONESIA_SOURCE_PRECEDENCE_VERSION} artifact set.`);
    const acquired=await acquireIndonesiaOfficialPdf({url:source.url,expected_bytes:pin?.bytes,expected_sha256:pin?.sha256,fetch_impl:args.fetch_impl});
    artifacts.push({...source,bytes:acquired.bytes});
  }
  return buildIndonesiaAuthorityBundle({release_identifier:args.release_identifier,source_url:INDONESIA_BASE_URL,artifacts,remedies:args.remedies});
}

export async function verifyIndonesiaAcquisitionGate(fetchImpl:typeof fetch=fetch){
  const sources=[
    ['PMK 26/2022',INDONESIA_BASE_URL,INDONESIA_PINNED_ARTIFACTS['26_PMK.010_2022.pdf']],
    ['PMK 50/2026',INDONESIA_PMK50_URL,INDONESIA_PINNED_ARTIFACTS['2026pmkeuangan050.pdf']],
    ['PMK 14/2026',INDONESIA_SAMPLE_REMEDY_URL,INDONESIA_PINNED_ARTIFACTS['2026pmkeuangan014.pdf']],
  ] as const;
  const results=[];
  for(const [instrument,url,pin] of sources){const acquired=await acquireIndonesiaOfficialPdf({url,expected_bytes:pin.bytes,expected_sha256:pin.sha256,fetch_impl:fetchImpl});results.push({instrument,url,size_bytes:acquired.size_bytes,sha256:acquired.sha256});}
  return {source_precedence_version:INDONESIA_SOURCE_PRECEDENCE_VERSION,preferred_repository:'JDIH BPK',legal_provenance:'JDIH Kementerian Keuangan',results};
}
