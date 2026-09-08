import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { ISRAEL_ACQUISITION_VERSION, ISRAEL_RESOURCES } from './israel-acquisition';

export const ISRAEL_BUNDLE_READER_VERSION = 'il-data-gov-ckan-bundle-reader-v1' as const;

const BUNDLE_FILES = new Set([
  'customs-tariff.json',
  'free-import-requirements.json',
  'additional-orders.json',
  'acquisition.json',
]);

export const ISRAEL_TARIFF_FIELDS = [
  '_id', 'CustomsBookTypeID', 'CustomsItem_2_Digits', 'CustomsItem_4_Digits',
  'CustomsItem_6_Digits', 'CustomsItemFullClassification', 'HierarchicLocation',
  'GoodsDescription', 'FullGoodsDescription', 'MeasurementUnitID',
  'MeasurementUnitDescription', 'CustomsItemEndDate', 'CustomsTariff',
  'CustomsTariffEndDate', 'PurchaseTaxTariff', 'PurchaseTaxTariffEndDate',
  'PercentageCapAdditionTariff', 'MaslulMeasurementUnit', 'CustomsItemCategoryID',
] as const;

export const ISRAEL_REQUIREMENT_FIELDS = [
  '_id', 'RegularityPublicationID', 'RegularityRequirementID', 'CustomsItemFullClassification',
  'FullGoodsDescription', 'CustomsItemCategoryID', 'EndDate', 'MeasurementUnitID',
  'MeasurementUnitDescription', 'MaslulMeasurementUnit', 'CustomsBookTypeID', 'CustomsBookType',
  'RegularityRequirement_CustomsItemFullClassification', 'InterConditionsRelationship',
  'CustomsItemParent_FullClassification', 'AutonomyRegularityRegionType', 'RegularityPublication',
  'InceptionCode', 'RegularitySource', 'RegularityRequirement_GoodsDescription',
  'RegularityRequirement_Authority', 'ConfirmationTypeID', 'ConfirmationType',
  'IsCarnetIncluded', 'TrNumber', 'UpdateDate',
] as const;

export type IsraelTariffRow = Record<(typeof ISRAEL_TARIFF_FIELDS)[number], unknown>;
export type IsraelRequirementRow = Record<(typeof ISRAEL_REQUIREMENT_FIELDS)[number], unknown> & {
  IsPersonalImportIncluded?: unknown;
  source_resource?: 'free_import' | 'additional_orders';
};

interface IsraelAcquisitionManifest {
  acquisition_version: typeof ISRAEL_ACQUISITION_VERSION;
  release_identifier: string;
  package_urls: { tariff: string; requirements: string };
  resources: Record<'tariff' | 'free_import' | 'additional_orders', {
    id: string; name: string; format: string; url: string; last_modified: string; size: number;
    package_metadata_modified: string; license_id: string; license_title: string;
    license_url: string;
  }>;
}

export interface IsraelAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  source_url: string;
  resources: IsraelAcquisitionManifest['resources'];
  tariff_rows: IsraelTariffRow[];
  requirement_rows: IsraelRequirementRow[];
  reader_version: typeof ISRAEL_BUNDLE_READER_VERSION;
}

export class IsraelBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'IsraelBundleError';
  }
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new IsraelBundleError('invalid_json', `${label} is not valid JSON.`);
  }
}

function datastoreRows<T extends Record<string, unknown>>(
  bytes: Buffer,
  label: string,
  expectedFields: readonly string[],
  allowedExtraFields: readonly string[] = [],
): T[] {
  const root = parseJson(bytes, label) as {
    success?: unknown;
    result?: { total?: unknown; fields?: unknown; records?: unknown };
  };
  if (root.success !== true || !root.result || !Array.isArray(root.result.fields) || !Array.isArray(root.result.records)) {
    throw new IsraelBundleError('invalid_datastore_response', `${label} is not a successful CKAN DataStore response.`);
  }
  const fields = root.result.fields.map((field) => String((field as { id?: unknown }).id ?? ''));
  const allowed = new Set([...expectedFields, ...allowedExtraFields]);
  const missing = expectedFields.filter((field) => !fields.includes(field));
  const extras = fields.filter((field) => !allowed.has(field));
  if (missing.length || extras.length) {
    throw new IsraelBundleError('unexpected_schema', `${label} schema changed (missing: ${missing.join(', ') || 'none'}; unexpected: ${extras.join(', ') || 'none'}).`);
  }
  if (typeof root.result.total !== 'number' || root.result.total !== root.result.records.length) {
    throw new IsraelBundleError('partial_datastore_response', `${label} did not retain all rows reported by CKAN DataStore.`);
  }
  if (!root.result.records.length) throw new IsraelBundleError('empty_dataset', `${label} contains no rows.`);
  return root.result.records as T[];
}

function validateManifest(value: unknown): IsraelAcquisitionManifest {
  const manifest = value as Partial<IsraelAcquisitionManifest>;
  if (manifest.acquisition_version !== ISRAEL_ACQUISITION_VERSION
      || typeof manifest.release_identifier !== 'string'
      || typeof manifest.package_urls?.tariff !== 'string'
      || typeof manifest.package_urls?.requirements !== 'string') {
    throw new IsraelBundleError('invalid_acquisition_manifest', 'The Israel acquisition manifest is incomplete or unsupported.');
  }
  const expected = [
    ['tariff', ISRAEL_RESOURCES.tariff],
    ['free_import', ISRAEL_RESOURCES.free_import],
    ['additional_orders', ISRAEL_RESOURCES.additional_orders],
  ] as const;
  for (const [key, id] of expected) {
    const resource = manifest.resources?.[key];
    if (!resource || resource.id !== id || resource.license_id !== 'other-open'
        || resource.license_url !== 'https://data.gov.il/terms-of-use'
        || resource.format.toUpperCase() !== 'CSV' || !resource.url.startsWith('https://')) {
      throw new IsraelBundleError('invalid_acquisition_manifest', `The Israel acquisition manifest has invalid metadata for ${key}.`);
    }
  }
  return manifest as IsraelAcquisitionManifest;
}

/** Decode a retained composite while refusing partial pages or silent schema drift. */
export async function readIsraelAuthorityBundle(bytes: Buffer): Promise<IsraelAuthorityBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new IsraelBundleError('corrupt_archive', 'The Israel authority bundle is not a readable ZIP archive.');
  }
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const names = entries.map((entry) => entry.name);
  if (names.length !== BUNDLE_FILES.size || names.some((name) => name.includes('/') || !BUNDLE_FILES.has(name))) {
    throw new IsraelBundleError('unexpected_bundle_files', 'The Israel bundle must contain exactly the three official DataStore responses and acquisition manifest.');
  }
  const tariffBytes = Buffer.from(await zip.file('customs-tariff.json')!.async('uint8array'));
  const freeImportBytes = Buffer.from(await zip.file('free-import-requirements.json')!.async('uint8array'));
  const additionalBytes = Buffer.from(await zip.file('additional-orders.json')!.async('uint8array'));
  const acquisitionBytes = Buffer.from(await zip.file('acquisition.json')!.async('uint8array'));
  const manifest = validateManifest(parseJson(acquisitionBytes, 'Israel acquisition manifest'));
  const tariffRows = datastoreRows<IsraelTariffRow>(tariffBytes, 'Israel customs tariff', ISRAEL_TARIFF_FIELDS);
  const freeImportRows = datastoreRows<IsraelRequirementRow>(freeImportBytes, 'Israel Free Import Order', ISRAEL_REQUIREMENT_FIELDS);
  const additionalRows = datastoreRows<IsraelRequirementRow>(additionalBytes, 'Israel additional orders', ISRAEL_REQUIREMENT_FIELDS, ['IsPersonalImportIncluded']);
  const file = (name: string, data: Buffer, role: string) => ({
    name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length, role,
  });
  return {
    checksum: createHash('sha256').update(bytes).digest('hex'),
    size_bytes: bytes.length,
    files: [
      file('customs-tariff.json', tariffBytes, 'official_customs_tariff_and_purchase_tax'),
      file('free-import-requirements.json', freeImportBytes, 'official_free_import_order_requirements'),
      file('additional-orders.json', additionalBytes, 'official_additional_import_orders'),
      file('acquisition.json', acquisitionBytes, 'acquisition_manifest'),
    ],
    release_identifier: manifest.release_identifier,
    source_url: manifest.package_urls.tariff,
    resources: manifest.resources,
    tariff_rows: tariffRows,
    requirement_rows: [
      ...freeImportRows.map((row) => ({ ...row, source_resource: 'free_import' as const })),
      ...additionalRows.map((row) => ({ ...row, source_resource: 'additional_orders' as const })),
    ],
    reader_version: ISRAEL_BUNDLE_READER_VERSION,
  };
}
