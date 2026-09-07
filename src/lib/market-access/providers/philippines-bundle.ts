import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const PHILIPPINES_ACQUISITION_VERSION = 'ph-tc-manual-composite-v1' as const;
export const PHILIPPINES_BUNDLE_READER_VERSION = 'ph-tc-composite-preflight-reader-v1' as const;

const ROLES = ['ahtn_2022_baseline', 'mfn_executive_order_overlay', 'aifta_annual_schedule'] as const;
type ComponentRole = typeof ROLES[number];

export class PhilippinesBundleError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'PhilippinesBundleError'; }
}

interface AcquisitionComponent {
  role: ComponentRole;
  filename: string;
  source_url: string;
  sha256: string;
  effective_from: string;
  legal_instrument?: string;
  schedule_year?: number;
  form_ai_required?: boolean;
}

interface PhilippinesAcquisitionManifest {
  acquisition_version: typeof PHILIPPINES_ACQUISITION_VERSION;
  release_identifier: string;
  retrieved_at: string;
  eo_62_overlap_review: { status: 'confirmed'; reviewed_at: string; basis: string };
  components: AcquisitionComponent[];
}

export interface PhilippinesAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string; source_url?: string; effective_from?: string }>;
  release_identifier: string;
  retrieved_at: Date;
  components: AcquisitionComponent[];
  reader_version: typeof PHILIPPINES_BUNDLE_READER_VERSION;
  /** Intentionally false until the real artifacts establish a parseable tariff schema. */
  tariff_rows_parsed: false;
}

function sha256(bytes: Buffer) { return createHash('sha256').update(bytes).digest('hex'); }
function validDate(value: unknown) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(value) && !Number.isNaN(new Date(value).getTime()); }
function officialUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'tariffcommission.gov.ph' || url.hostname === 'www.tariffcommission.gov.ph' || url.hostname === 'finder.tariffcommission.gov.ph' || url.hostname === 'www.officialgazette.gov.ph' || url.hostname === 'officialgazette.gov.ph' || url.hostname === 'drive.google.com');
  } catch { return false; }
}

async function validateFileShape(name: string, bytes: Buffer) {
  if (/\.pdf$/i.test(name)) {
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new PhilippinesBundleError('invalid_pdf', `${name} is not a PDF artifact.`);
    return;
  }
  if (/\.xlsx$/i.test(name)) {
    let zip: JSZip;
    try { zip = await JSZip.loadAsync(bytes); } catch { throw new PhilippinesBundleError('invalid_xlsx', `${name} is not a readable XLSX artifact.`); }
    if (!zip.file('[Content_Types].xml') || !zip.file('xl/workbook.xml')) throw new PhilippinesBundleError('invalid_xlsx', `${name} does not contain the required XLSX workbook parts.`);
    return;
  }
  if (/\.xls$/i.test(name)) {
    if (bytes.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1') throw new PhilippinesBundleError('invalid_xls', `${name} is not an OLE XLS artifact.`);
    return;
  }
  throw new PhilippinesBundleError('unsupported_component_format', `${name} is not one of the manually supported official PDF/XLS/XLSX artifact formats.`);
}

/**
 * Validate the controlled operator package without pretending to parse a tariff structure that
 * the project has not observed. The wrapper manifest is ClearTrade provenance; every other byte
 * must be an original official artifact with its own URL and checksum.
 */
export async function readPhilippinesAuthorityBundle(bytes: Buffer): Promise<PhilippinesAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new PhilippinesBundleError('corrupt_archive', 'The Philippines authority release is not a readable ZIP archive.'); }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length || entries.some((entry) => entry.name.includes('/'))) throw new PhilippinesBundleError('unexpected_bundle_files', 'The manual composite must contain root-level files only.');
  const manifestEntry = zip.file('acquisition.json');
  if (!manifestEntry) throw new PhilippinesBundleError('missing_manifest', 'The manual composite has no acquisition.json provenance manifest.');
  let manifest: PhilippinesAcquisitionManifest;
  try { manifest = JSON.parse(await manifestEntry.async('text')) as PhilippinesAcquisitionManifest; }
  catch { throw new PhilippinesBundleError('invalid_manifest', 'The Philippines acquisition manifest is not valid JSON.'); }
  if (manifest.acquisition_version !== PHILIPPINES_ACQUISITION_VERSION || !manifest.release_identifier?.trim() || !validDate(manifest.retrieved_at) || manifest.eo_62_overlap_review?.status !== 'confirmed' || !validDate(manifest.eo_62_overlap_review.reviewed_at) || !manifest.eo_62_overlap_review.basis?.trim() || !Array.isArray(manifest.components)) {
    throw new PhilippinesBundleError('invalid_manifest', 'The Philippines acquisition manifest is incomplete or from an unsupported version.');
  }
  for (const role of ROLES) {
    if (!manifest.components.some((component) => component.role === role)) throw new PhilippinesBundleError('missing_component', `The composite has no ${role} artifact.`);
  }
  const declared = new Set(['acquisition.json']);
  const files: PhilippinesAuthorityBundle['files'] = [];
  for (const component of manifest.components) {
    if (!ROLES.includes(component.role) || !component.filename || component.filename.includes('/') || declared.has(component.filename) || !officialUrl(component.source_url) || !/^[a-f0-9]{64}$/.test(component.sha256) || !validDate(component.effective_from)) {
      throw new PhilippinesBundleError('invalid_component', `The ${component.role ?? 'unknown'} component has invalid identity, authority URL, checksum or effective date.`);
    }
    if (component.role === 'mfn_executive_order_overlay' && !/Executive Order (?:No\.\s*)?62/i.test(component.legal_instrument ?? '')) throw new PhilippinesBundleError('missing_eo_62', 'The MFN overlay is not identified as Executive Order No. 62.');
    if (component.role === 'aifta_annual_schedule' && (!Number.isInteger(component.schedule_year) || component.form_ai_required !== true)) throw new PhilippinesBundleError('invalid_aifta_metadata', 'The annual AIFTA component must identify its schedule year and Form AI requirement.');
    const entry = zip.file(component.filename);
    if (!entry) throw new PhilippinesBundleError('missing_component_file', `The declared component ${component.filename} is absent.`);
    const fileBytes = Buffer.from(await entry.async('uint8array'));
    await validateFileShape(component.filename, fileBytes);
    const digest = sha256(fileBytes);
    if (digest !== component.sha256) throw new PhilippinesBundleError('checksum_mismatch', `${component.filename} does not match its acquisition checksum.`);
    declared.add(component.filename);
    files.push({ name: component.filename, sha256: digest, size_bytes: fileBytes.length, role: component.role, source_url: component.source_url, effective_from: component.effective_from });
  }
  if (entries.length !== declared.size || entries.some((entry) => !declared.has(entry.name))) throw new PhilippinesBundleError('undeclared_component', 'The composite contains a file not declared in acquisition.json.');
  const manifestBytes = Buffer.from(await manifestEntry.async('uint8array'));
  files.push({ name: 'acquisition.json', sha256: sha256(manifestBytes), size_bytes: manifestBytes.length, role: 'controlled_manual_acquisition_manifest' });
  return { checksum: sha256(bytes), size_bytes: bytes.length, files, release_identifier: manifest.release_identifier.trim(), retrieved_at: new Date(manifest.retrieved_at), components: manifest.components, reader_version: PHILIPPINES_BUNDLE_READER_VERSION, tariff_rows_parsed: false };
}
