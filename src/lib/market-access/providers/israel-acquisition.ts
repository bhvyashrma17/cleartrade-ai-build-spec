import JSZip from 'jszip';

export const ISRAEL_ACQUISITION_VERSION = 'il-data-gov-ckan-v1' as const;

export const ISRAEL_RESOURCES = Object.freeze({
  tariff: 'c96d99fe-fd3a-4e86-a767-4119dd8b723e',
  free_import: 'a36db570-09f2-4521-8e3d-0290eb839c68',
  additional_orders: 'd9750b40-c0b9-4e05-a08e-ae768a92e9ca',
});

const AUTHORITY_HOST = 'data.gov.il';
const MAX_RESPONSE_BYTES = 80 * 1024 * 1024;

export interface IsraelAcquisitionRequest {
  release_identifier: string;
}

function officialUrl(path: string) {
  const url = new URL(path, `https://${AUTHORITY_HOST}`);
  if (url.protocol !== 'https:' || url.hostname !== AUTHORITY_HOST) {
    throw new Error(`Israel authority acquisition only accepts HTTPS sources from ${AUTHORITY_HOST}.`);
  }
  return url.toString();
}

async function fetchJsonBytes(url: string, options: { fetch_impl?: typeof fetch; attempts?: number }) {
  const fetchImpl = options.fetch_impl ?? fetch;
  const attempts = options.attempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(officialUrl(url), {
        headers: { accept: 'application/json', 'user-agent': 'ClearTrade-Customs-Atlas/1.0' },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new Error(`Israel data.gov.il returned ${retryable ? 'retryable' : 'non-retryable'} HTTP ${response.status} for ${url}.`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error(`Israel data.gov.il returned an empty response for ${url}.`);
      if (bytes.length > MAX_RESPONSE_BYTES) throw new Error(`Israel data.gov.il response exceeded ${MAX_RESPONSE_BYTES} bytes for ${url}.`);
      JSON.parse(bytes.toString('utf8'));
      return bytes;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || /non-retryable|exceeded/.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 100));
    }
  }
  throw lastError;
}

function packageResource(metadata: unknown, resourceId: string) {
  const root = metadata as { success?: unknown; result?: { license_id?: unknown; license_title?: unknown; metadata_modified?: unknown; resources?: unknown } };
  if (root.success !== true || !root.result || !Array.isArray(root.result.resources)) {
    throw new Error('Israel data.gov.il returned an invalid CKAN package response.');
  }
  if (root.result.license_id !== 'other-open') {
    throw new Error(`Israel data.gov.il package no longer carries the expected other-open licence (${String(root.result.license_id)}).`);
  }
  const resource = root.result.resources.find((value) => (value as { id?: unknown }).id === resourceId) as Record<string, unknown> | undefined;
  if (!resource) throw new Error(`Israel data.gov.il package no longer contains resource ${resourceId}.`);
  return {
    id: resourceId,
    name: String(resource.name ?? ''),
    format: String(resource.format ?? ''),
    url: String(resource.url ?? ''),
    last_modified: String(resource.last_modified ?? ''),
    size: Number(resource.size ?? 0),
    package_metadata_modified: String(root.result.metadata_modified ?? ''),
    license_id: String(root.result.license_id),
    license_title: String(root.result.license_title ?? ''),
    license_url: 'https://data.gov.il/terms-of-use',
  };
}

/**
 * Acquire the exact official CKAN DataStore responses and retain them in one immutable bundle.
 * The raw e.data.gov.il CSV host rejects automated retrieval, while the dataset's documented
 * data.gov.il CKAN API exposes the same registered resources without bypassing an access control.
 */
export async function acquireIsraelAuthorityBundle(
  request: IsraelAcquisitionRequest,
  options: { fetch_impl?: typeof fetch; attempts?: number } = {},
) {
  const tariffPackageUrl = officialUrl('/api/3/action/package_show?id=customsbook');
  const requirementsPackageUrl = officialUrl('/api/3/action/package_show?id=regularityrequirement');
  const [tariffPackageBytes, requirementsPackageBytes] = await Promise.all([
    fetchJsonBytes(tariffPackageUrl, options),
    fetchJsonBytes(requirementsPackageUrl, options),
  ]);
  const tariffPackage = JSON.parse(tariffPackageBytes.toString('utf8')) as unknown;
  const requirementsPackage = JSON.parse(requirementsPackageBytes.toString('utf8')) as unknown;
  const resources = {
    tariff: packageResource(tariffPackage, ISRAEL_RESOURCES.tariff),
    free_import: packageResource(requirementsPackage, ISRAEL_RESOURCES.free_import),
    additional_orders: packageResource(requirementsPackage, ISRAEL_RESOURCES.additional_orders),
  };
  for (const resource of Object.values(resources)) {
    const registered = new URL(resource.url);
    if (registered.protocol !== 'https:' || !registered.hostname.endsWith('.data.gov.il')) {
      throw new Error(`Israel resource ${resource.id} is no longer registered on an official data.gov.il host.`);
    }
  }

  const datastoreUrl = (id: string) => officialUrl(`/api/3/action/datastore_search?resource_id=${id}&limit=50000`);
  const [tariff, freeImport, additionalOrders] = await Promise.all([
    fetchJsonBytes(datastoreUrl(ISRAEL_RESOURCES.tariff), options),
    fetchJsonBytes(datastoreUrl(ISRAEL_RESOURCES.free_import), options),
    fetchJsonBytes(datastoreUrl(ISRAEL_RESOURCES.additional_orders), options),
  ]);
  const acquisition = {
    acquisition_version: ISRAEL_ACQUISITION_VERSION,
    release_identifier: request.release_identifier.trim(),
    package_urls: { tariff: tariffPackageUrl, requirements: requirementsPackageUrl },
    resources,
  };
  const bundle = new JSZip();
  const fileOptions = { date: new Date('1980-01-01T00:00:00.000Z'), createFolders: false } as const;
  bundle.file('customs-tariff.json', tariff, fileOptions);
  bundle.file('free-import-requirements.json', freeImport, fileOptions);
  bundle.file('additional-orders.json', additionalOrders, fileOptions);
  bundle.file('acquisition.json', JSON.stringify(acquisition, null, 2), fileOptions);
  return bundle.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}
