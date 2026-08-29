import { createHash } from 'node:crypto';

export const COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION = 'country-truth-exporter-facts-v1' as const;

export type CountryTruthFactState = 'present' | 'unknown' | 'confirmed_absent';
export type CountryTruthAssertionClass = 'exporter_declared' | 'agent_verified';
export type CountryTruthVerificationStatus = 'unverified' | 'verified';

type DateInput = Date | string;
type DecimalInput = string | number | bigint | { toString(): string };

export interface FactAttributionInput {
  actor_user_id?: string | null;
  evidence_refs?: readonly string[] | null;
}

export interface ExplicitAgentVerificationInput extends FactAttributionInput {
  verification_status: 'verified';
  verified_at: DateInput;
}

export type ExporterOrgFactField =
  | 'country'
  | 'state'
  | 'city'
  | 'pickup_location_code'
  | 'preferred_origin_gateway';

export type ProductFactField =
  | 'price_target_amount'
  | 'price_target_currency'
  | 'price_target_quantity_unit'
  | 'price_target_incoterm'
  | 'capacity_value'
  | 'capacity_unit'
  | 'moq_value'
  | 'moq_unit'
  | 'lead_time_days'
  | 'delivery_commitment_days'
  | 'logistics_constraint_codes'
  | 'logistics_constraints_confirmed'
  | 'desired_order_size_amount'
  | 'desired_order_size_currency'
  | 'customization_capability'
  | 'packaging_capability'
  | 'packaging';

export interface ExporterOrgFactSource {
  id: string;
  country: string | null;
  state?: string | null;
  city?: string | null;
  pickup_location_code?: string | null;
  preferred_origin_gateway?: string | null;
  updated_at: DateInput;
}

export interface ProductFactSource {
  id: string;
  exporter_org_id: string;
  updated_at: DateInput;
  evidence_origin?: string | null;

  hs_code?: string | null;
  hs_nomenclature_version?: string | null;
  hs_classification_revision: number;
  hs_classification_status?: string | null;

  price_target_amount?: DecimalInput | null;
  price_target_currency?: string | null;
  price_target_quantity_unit?: string | null;
  price_target_incoterm?: string | null;
  capacity_value?: DecimalInput | null;
  capacity_unit?: string | null;
  moq_value?: DecimalInput | null;
  moq_unit?: string | null;
  lead_time_days?: number | null;
  delivery_commitment_days?: number | null;
  logistics_constraint_codes: readonly string[];
  logistics_constraints_confirmed: boolean;
  desired_order_size_amount?: DecimalInput | null;
  desired_order_size_currency?: string | null;
  customization_capability?: string | null;
  packaging_capability?: string | null;
  packaging?: string | null;
}

export type CertificationLifecycleStatus =
  | 'not_started'
  | 'in_progress'
  | 'held'
  | 'expired'
  | 'not_applicable';

export interface ProductCertificationFactSource {
  id: string;
  product_id: string;
  code: string;
  name: string;
  status: CertificationLifecycleStatus;
  evidence_ref?: string | null;
  valid_until?: DateInput | null;
  updated_at: DateInput;
  /** Who recorded the mutable master-data declaration; this never makes it verified. */
  attribution?: FactAttributionInput | null;
  /** The only input which may elevate this certification assertion to agent-verified. */
  verification?: ExplicitAgentVerificationInput | null;
}

export interface ConfirmedProductClassificationFactSource {
  id: string;
  product_id: string;
  revision: number;
  hs6_code: string;
  nomenclature_version: string;
  /** Runtime validation requires `confirmed`; widened so a plain enum-shaped row is assignable. */
  status: string;
  confirmed_by_id?: string | null;
  confirmed_at?: DateInput | null;
  evidence_refs?: readonly string[] | null;
}

export interface CountryTruthExporterFactSnapshotInput {
  exporter_org: ExporterOrgFactSource;
  product: ProductFactSource;
  certifications: readonly ProductCertificationFactSource[];
  classification: ConfirmedProductClassificationFactSource;
  captured_at: DateInput;
  /** Optional field-level audit/evidence pointers. They do not change epistemic class. */
  attributions?: {
    exporter_org?: Partial<Record<ExporterOrgFactField, FactAttributionInput>>;
    product?: Partial<Record<ProductFactField, FactAttributionInput>>;
  };
}

export interface CountryTruthFactProvenance {
  assertion_class: CountryTruthAssertionClass;
  verification_status: CountryTruthVerificationStatus;
  actor_user_id?: string;
  evidence_refs?: readonly string[];
  verified_at?: string;
}

export type CountryTruthFact<T> =
  | Readonly<{ state: 'present'; value: T; provenance: CountryTruthFactProvenance }>
  | Readonly<{ state: 'unknown'; value: null }>
  | Readonly<{ state: 'confirmed_absent'; value: null; provenance: CountryTruthFactProvenance }>;

export interface CountryTruthCertificationFact {
  certification_id: string;
  code: string;
  name: string;
  source_updated_at: string;
  lifecycle_status: CountryTruthFact<CertificationLifecycleStatus>;
  /** Whether a currently held certification is affirmatively known. */
  holding: CountryTruthFact<'held'>;
  evidence_ref: CountryTruthFact<string>;
  valid_until: CountryTruthFact<string>;
}

export interface CountryTruthExporterFactSnapshot {
  schema_version: typeof COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION;
  captured_at: string;
  identity: {
    exporter_org_id: string;
    product_id: string;
    product_classification_id: string;
    classification_revision: number;
    hs6: string;
    hs_revision: string;
  };
  source_records: {
    exporter_org: { id: string; updated_at: string };
    product: { id: string; updated_at: string; evidence_origin: string | null };
  };
  hs_classification: CountryTruthFact<{
    classification_id: string;
    classification_revision: number;
    hs6: string;
    hs_revision: string;
  }>;
  origin: {
    country: CountryTruthFact<string>;
    state: CountryTruthFact<string>;
    city: CountryTruthFact<string>;
    pickup_location_code: CountryTruthFact<string>;
    preferred_origin_gateway: CountryTruthFact<string>;
  };
  commercial: {
    price_target: {
      amount: CountryTruthFact<string>;
      currency: CountryTruthFact<string>;
      quantity_unit: CountryTruthFact<string>;
      incoterm: CountryTruthFact<string>;
    };
    capacity: { value: CountryTruthFact<string>; unit: CountryTruthFact<string> };
    minimum_order_quantity: { value: CountryTruthFact<string>; unit: CountryTruthFact<string> };
    lead_time_days: CountryTruthFact<number>;
    delivery_commitment_days: CountryTruthFact<number>;
    logistics_constraints: CountryTruthFact<readonly string[]>;
    logistics_constraints_confirmation: CountryTruthFact<true>;
    desired_order_size: { amount: CountryTruthFact<string>; currency: CountryTruthFact<string> };
    customization_capability: CountryTruthFact<string>;
    packaging_capability: CountryTruthFact<string>;
    packaging_description: CountryTruthFact<string>;
  };
  certifications: {
    /** No rows means unknown, never a declaration that no certification is held. */
    state: 'present' | 'unknown';
    unlisted_certifications_state: 'unknown';
    items: readonly CountryTruthCertificationFact[];
  };
}

export interface BuiltCountryTruthExporterFactSnapshot {
  snapshot: CountryTruthExporterFactSnapshot;
  checksum: string;
}

const CERTIFICATION_STATUSES = new Set<CertificationLifecycleStatus>([
  'not_started',
  'in_progress',
  'held',
  'expired',
  'not_applicable',
]);

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  if (value == null) return undefined;
  return requiredIdentifier(value, label);
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new Error('Fact text values must be strings when supplied.');
  const normalized = value.trim();
  return normalized || null;
}

function isoDate(value: DateInput, label: string): string {
  if (!(value instanceof Date) && typeof value !== 'string') throw new Error(`${label} must be a Date or date-time string.`);
  if (typeof value === 'string' && !value.trim()) throw new Error(`${label} is invalid.`);
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value.trim());
    if (!match) throw new Error(`${label} is invalid.`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = match[4] == null ? 0 : Number(match[4]);
    const minute = match[5] == null ? 0 : Number(match[5]);
    const second = match[6] == null ? 0 : Number(match[6]);
    const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
    if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) throw new Error(`${label} is invalid.`);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} is invalid.`);
  return date.toISOString();
}

function optionalIsoDate(value: DateInput | null | undefined, label: string): string | null {
  return value == null ? null : isoDate(value, label);
}

/** Exact decimal canonicalization; it never converts between measurement units. */
function decimalString(value: DecimalInput, label: string): string {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  let raw: string;
  try {
    raw = typeof value === 'string' ? value.trim() : value.toString().trim();
  } catch {
    throw new Error(`${label} is not a valid decimal.`);
  }
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(raw);
  if (!match) throw new Error(`${label} is not a valid finite decimal.`);
  const exponent = match[4] == null ? 0 : Number(match[4]);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) throw new Error(`${label} exponent is out of range.`);

  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2]!;
  const fraction = match[3] ?? '';
  const digits = integer + fraction;
  const decimalIndex = integer.length + exponent;
  let whole: string;
  let decimals: string;
  if (decimalIndex <= 0) {
    whole = '0';
    decimals = `${'0'.repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    whole = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
    decimals = '';
  } else {
    whole = digits.slice(0, decimalIndex);
    decimals = digits.slice(decimalIndex);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  decimals = decimals.replace(/0+$/, '');
  const unsigned = decimals ? `${whole}.${decimals}` : whole;
  return /^0(?:\.0*)?$/.test(unsigned) ? '0' : `${sign}${unsigned}`;
}

function optionalDecimal(value: DecimalInput | null | undefined, label: string): string | null {
  return value == null ? null : decimalString(value, label);
}

function optionalNonNegativeInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative integer.`);
  }
  return value;
}

function positiveRevision(value: number, label: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function currency(value: unknown, label: string): string | null {
  const normalized = optionalText(value)?.toUpperCase() ?? null;
  if (normalized != null && !/^[A-Z]{3}$/.test(normalized)) throw new Error(`${label} must be a three-letter currency code.`);
  return normalized;
}

function code(value: unknown): string | null {
  return optionalText(value)?.replace(/\s+/g, ' ').toUpperCase() ?? null;
}

function countryCode(value: unknown): string | null {
  const normalized = code(value);
  if (normalized != null && !/^[A-Z]{2}$/.test(normalized)) throw new Error('exporter_org.country must be an ISO alpha-2 code.');
  return normalized;
}

function incoterm(value: unknown): string | null {
  const normalized = code(value);
  if (normalized != null && !/^[A-Z]{3}$/.test(normalized)) throw new Error('product.price_target_incoterm must be a three-letter Incoterm code.');
  return normalized;
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  kgs: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  mt: 'tonne',
  mts: 'tonne',
  tonnes: 'tonne',
  'metric tonne': 'tonne',
  'metric tonnes': 'tonne',
  pcs: 'piece',
  pieces: 'piece',
  units: 'unit',
  l: 'litre',
  ltr: 'litre',
  ltrs: 'litre',
  liter: 'litre',
  liters: 'litre',
  litres: 'litre',
};

function unit(value: unknown): string | null {
  const text = optionalText(value);
  if (text == null) return null;
  const normalized = text.toLowerCase().replace(/\s+per\s+/g, '/').replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ');
  const parts = normalized.split('/');
  if (parts.some(part => !part)) throw new Error('Measurement units must not contain an empty basis segment.');
  return parts.map(part => UNIT_ALIASES[part] ?? part).join('/');
}

function normalizedRefs(values: readonly string[] | null | undefined, label: string): string[] {
  if (values == null) return [];
  const refs = values.map((value, index) => requiredIdentifier(value, `${label}[${index}]`));
  return [...new Set(refs)].sort((a, b) => a.localeCompare(b));
}

function provenance(
  assertionClass: CountryTruthAssertionClass,
  verificationStatus: CountryTruthVerificationStatus,
  attribution?: FactAttributionInput | null,
  verifiedAt?: string,
  additionalEvidenceRefs: readonly string[] = [],
): CountryTruthFactProvenance {
  const actor = optionalIdentifier(attribution?.actor_user_id, 'actor_user_id');
  const evidenceRefs = normalizedRefs(
    [...(attribution?.evidence_refs ?? []), ...additionalEvidenceRefs],
    'evidence_refs',
  );
  return {
    assertion_class: assertionClass,
    verification_status: verificationStatus,
    ...(actor ? { actor_user_id: actor } : {}),
    ...(evidenceRefs.length ? { evidence_refs: evidenceRefs } : {}),
    ...(verifiedAt ? { verified_at: verifiedAt } : {}),
  };
}

function unknownFact<T>(): CountryTruthFact<T> {
  return { state: 'unknown', value: null };
}

function presentFact<T>(value: T, factProvenance: CountryTruthFactProvenance): CountryTruthFact<T> {
  return { state: 'present', value, provenance: factProvenance };
}

function confirmedAbsentFact<T>(factProvenance: CountryTruthFactProvenance): CountryTruthFact<T> {
  return { state: 'confirmed_absent', value: null, provenance: factProvenance };
}

function declaredFact<T>(value: T | null, attribution?: FactAttributionInput): CountryTruthFact<T> {
  return value == null ? unknownFact<T>() : presentFact(value, provenance('exporter_declared', 'unverified', attribution));
}

function certificationProvenance(certification: ProductCertificationFactSource): CountryTruthFactProvenance {
  const evidenceRef = optionalText(certification.evidence_ref);
  if (!certification.verification) {
    return provenance(
      'exporter_declared',
      'unverified',
      certification.attribution,
      undefined,
      evidenceRef ? [evidenceRef] : [],
    );
  }
  if (certification.verification.verification_status !== 'verified') {
    throw new Error(`Certification ${certification.id} has an unsupported verification status.`);
  }
  return provenance(
    'agent_verified',
    'verified',
    certification.verification,
    isoDate(certification.verification.verified_at, `certification ${certification.id} verified_at`),
    evidenceRef ? [evidenceRef] : [],
  );
}

function certificationFact(
  certification: ProductCertificationFactSource,
  productId: string,
): CountryTruthCertificationFact {
  const certificationId = requiredIdentifier(certification.id, 'certification.id');
  if (requiredIdentifier(certification.product_id, `certification ${certificationId} product_id`) !== productId) {
    throw new Error(`Certification ${certificationId} does not belong to product ${productId}.`);
  }
  if (!CERTIFICATION_STATUSES.has(certification.status)) {
    throw new Error(`Certification ${certificationId} has an unsupported lifecycle status.`);
  }
  const normalizedCode = code(certification.code);
  if (!normalizedCode) throw new Error(`Certification ${certificationId} code must be non-empty.`);
  const normalizedName = optionalText(certification.name);
  if (!normalizedName) throw new Error(`Certification ${certificationId} name must be non-empty.`);
  const certProvenance = certificationProvenance(certification);
  const evidenceRef = optionalText(certification.evidence_ref);
  const validUntil = optionalIsoDate(certification.valid_until, `certification ${certificationId} valid_until`);
  const holding = certification.status === 'held'
    ? presentFact<'held'>('held', certProvenance)
    : certification.status === 'not_started'
      ? confirmedAbsentFact<'held'>(certProvenance)
      : unknownFact<'held'>();

  return {
    certification_id: certificationId,
    code: normalizedCode,
    name: normalizedName,
    source_updated_at: isoDate(certification.updated_at, `certification ${certificationId} updated_at`),
    lifecycle_status: presentFact(certification.status, certProvenance),
    holding,
    evidence_ref: evidenceRef == null ? unknownFact<string>() : presentFact(evidenceRef, certProvenance),
    valid_until: validUntil == null ? unknownFact<string>() : presentFact(validUntil, certProvenance),
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function countryTruthExporterFactSnapshotChecksum(snapshot: CountryTruthExporterFactSnapshot): string {
  return createHash('sha256').update(JSON.stringify(canonical(snapshot))).digest('hex');
}

/**
 * Freezes only facts present in canonical exporter master data at capture time.
 *
 * The function performs no IO, never reads wall clock, never infers a missing fact, and never
 * treats a row's deployment-oriented EvidenceOrigin as epistemic verification.
 */
export function buildCountryTruthExporterFactSnapshot(
  input: CountryTruthExporterFactSnapshotInput,
): BuiltCountryTruthExporterFactSnapshot {
  const exporterOrgId = requiredIdentifier(input.exporter_org.id, 'exporter_org.id');
  const productId = requiredIdentifier(input.product.id, 'product.id');
  if (requiredIdentifier(input.product.exporter_org_id, 'product.exporter_org_id') !== exporterOrgId) {
    throw new Error(`Product ${productId} does not belong to exporter ${exporterOrgId}.`);
  }

  const classificationId = requiredIdentifier(input.classification.id, 'classification.id');
  if (input.classification.status !== 'confirmed') throw new Error('Country Truth requires a confirmed ProductClassification.');
  if (requiredIdentifier(input.classification.product_id, 'classification.product_id') !== productId) {
    throw new Error(`Classification ${classificationId} does not belong to product ${productId}.`);
  }
  const classificationRevision = positiveRevision(input.classification.revision, 'classification.revision');
  const productClassificationRevision = positiveRevision(input.product.hs_classification_revision, 'product.hs_classification_revision');
  if (classificationRevision !== productClassificationRevision) {
    throw new Error('The confirmed classification revision does not match the Product master record.');
  }
  if (input.product.hs_classification_status != null && input.product.hs_classification_status !== 'confirmed') {
    throw new Error('The Product master record does not identify the supplied classification as confirmed.');
  }

  const hs6 = requiredIdentifier(input.classification.hs6_code, 'classification.hs6_code');
  if (!/^\d{6}$/.test(hs6)) throw new Error('classification.hs6_code must be exactly six digits.');
  const hsRevision = requiredIdentifier(input.classification.nomenclature_version, 'classification.nomenclature_version').toUpperCase();
  if (hsRevision === 'UNKNOWN') throw new Error('classification.nomenclature_version must be explicit.');
  if (input.product.hs_code != null && requiredIdentifier(input.product.hs_code, 'product.hs_code') !== hs6) {
    throw new Error('The confirmed HS6 does not match the Product master record.');
  }
  if (
    input.product.hs_nomenclature_version != null
    && requiredIdentifier(input.product.hs_nomenclature_version, 'product.hs_nomenclature_version').toUpperCase() !== hsRevision
  ) {
    throw new Error('The confirmed HS revision does not match the Product master record.');
  }

  const orgAttribution = (field: ExporterOrgFactField) => input.attributions?.exporter_org?.[field];
  const productAttribution = (field: ProductFactField) => input.attributions?.product?.[field];
  if (!Array.isArray(input.product.logistics_constraint_codes)) {
    throw new Error('product.logistics_constraint_codes must be an array.');
  }
  if (typeof input.product.logistics_constraints_confirmed !== 'boolean') {
    throw new Error('product.logistics_constraints_confirmed must be boolean.');
  }
  const constraintCodes = [...new Set(input.product.logistics_constraint_codes.map((item, index) => {
    const normalized = code(item);
    if (!normalized) throw new Error(`product.logistics_constraint_codes[${index}] must be non-empty.`);
    return normalized;
  }))].sort((left, right) => left.localeCompare(right));

  if (!Array.isArray(input.certifications)) throw new Error('certifications must be an array.');
  const certificationIds = new Set<string>();
  const certificationCodes = new Set<string>();
  const certifications = input.certifications.map(item => certificationFact(item, productId));
  for (const item of certifications) {
    if (certificationIds.has(item.certification_id)) throw new Error(`Duplicate certification id ${item.certification_id}.`);
    if (certificationCodes.has(item.code)) throw new Error(`Duplicate certification code ${item.code}.`);
    certificationIds.add(item.certification_id);
    certificationCodes.add(item.code);
  }
  certifications.sort((left, right) => left.code.localeCompare(right.code) || left.certification_id.localeCompare(right.certification_id));

  const classificationConfirmedAt = optionalIsoDate(input.classification.confirmed_at, 'classification.confirmed_at');
  const classificationProvenance = provenance(
    'agent_verified',
    'verified',
    {
      ...(input.classification.confirmed_by_id ? { actor_user_id: input.classification.confirmed_by_id } : {}),
      ...(input.classification.evidence_refs ? { evidence_refs: input.classification.evidence_refs } : {}),
    },
    classificationConfirmedAt ?? undefined,
  );
  const productEvidenceOrigin = optionalText(input.product.evidence_origin)?.toLowerCase() ?? null;
  const productProvenance = (field: ProductFactField) => provenance('exporter_declared', 'unverified', productAttribution(field));

  const snapshot: CountryTruthExporterFactSnapshot = {
    schema_version: COUNTRY_TRUTH_EXPORTER_FACTS_SCHEMA_VERSION,
    captured_at: isoDate(input.captured_at, 'captured_at'),
    identity: {
      exporter_org_id: exporterOrgId,
      product_id: productId,
      product_classification_id: classificationId,
      classification_revision: classificationRevision,
      hs6,
      hs_revision: hsRevision,
    },
    source_records: {
      exporter_org: {
        id: exporterOrgId,
        updated_at: isoDate(input.exporter_org.updated_at, 'exporter_org.updated_at'),
      },
      product: {
        id: productId,
        updated_at: isoDate(input.product.updated_at, 'product.updated_at'),
        evidence_origin: productEvidenceOrigin,
      },
    },
    hs_classification: presentFact(
      {
        classification_id: classificationId,
        classification_revision: classificationRevision,
        hs6,
        hs_revision: hsRevision,
      },
      classificationProvenance,
    ),
    origin: {
      country: declaredFact(countryCode(input.exporter_org.country), orgAttribution('country')),
      state: declaredFact(optionalText(input.exporter_org.state), orgAttribution('state')),
      city: declaredFact(optionalText(input.exporter_org.city), orgAttribution('city')),
      pickup_location_code: declaredFact(code(input.exporter_org.pickup_location_code), orgAttribution('pickup_location_code')),
      preferred_origin_gateway: declaredFact(code(input.exporter_org.preferred_origin_gateway), orgAttribution('preferred_origin_gateway')),
    },
    commercial: {
      price_target: {
        amount: declaredFact(optionalDecimal(input.product.price_target_amount, 'product.price_target_amount'), productAttribution('price_target_amount')),
        currency: declaredFact(currency(input.product.price_target_currency, 'product.price_target_currency'), productAttribution('price_target_currency')),
        quantity_unit: declaredFact(unit(input.product.price_target_quantity_unit), productAttribution('price_target_quantity_unit')),
        incoterm: declaredFact(incoterm(input.product.price_target_incoterm), productAttribution('price_target_incoterm')),
      },
      capacity: {
        value: declaredFact(optionalDecimal(input.product.capacity_value, 'product.capacity_value'), productAttribution('capacity_value')),
        unit: declaredFact(unit(input.product.capacity_unit), productAttribution('capacity_unit')),
      },
      minimum_order_quantity: {
        value: declaredFact(optionalDecimal(input.product.moq_value, 'product.moq_value'), productAttribution('moq_value')),
        unit: declaredFact(unit(input.product.moq_unit), productAttribution('moq_unit')),
      },
      lead_time_days: declaredFact(optionalNonNegativeInteger(input.product.lead_time_days, 'product.lead_time_days'), productAttribution('lead_time_days')),
      delivery_commitment_days: declaredFact(
        optionalNonNegativeInteger(input.product.delivery_commitment_days, 'product.delivery_commitment_days'),
        productAttribution('delivery_commitment_days'),
      ),
      logistics_constraints: constraintCodes.length
        ? presentFact(constraintCodes, productProvenance('logistics_constraint_codes'))
        : input.product.logistics_constraints_confirmed
          ? confirmedAbsentFact(productProvenance('logistics_constraints_confirmed'))
          : unknownFact<readonly string[]>(),
      logistics_constraints_confirmation: input.product.logistics_constraints_confirmed
        ? presentFact<true>(true, productProvenance('logistics_constraints_confirmed'))
        : unknownFact<true>(),
      desired_order_size: {
        amount: declaredFact(optionalDecimal(input.product.desired_order_size_amount, 'product.desired_order_size_amount'), productAttribution('desired_order_size_amount')),
        currency: declaredFact(currency(input.product.desired_order_size_currency, 'product.desired_order_size_currency'), productAttribution('desired_order_size_currency')),
      },
      customization_capability: declaredFact(optionalText(input.product.customization_capability), productAttribution('customization_capability')),
      packaging_capability: declaredFact(optionalText(input.product.packaging_capability), productAttribution('packaging_capability')),
      packaging_description: declaredFact(optionalText(input.product.packaging), productAttribution('packaging')),
    },
    certifications: {
      state: certifications.length ? 'present' : 'unknown',
      unlisted_certifications_state: 'unknown',
      items: certifications,
    },
  };

  const checksum = countryTruthExporterFactSnapshotChecksum(snapshot);
  return deepFreeze({ snapshot: deepFreeze(snapshot), checksum });
}
