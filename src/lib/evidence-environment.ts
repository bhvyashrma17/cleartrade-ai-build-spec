import { EvidenceOrigin, Prisma, TradeSourceMode } from '@prisma/client';

export type ClearTradeEnvironment = 'test' | 'development' | 'demo' | 'staging' | 'production';

const REAL_EVIDENCE: EvidenceOrigin[] = [
  EvidenceOrigin.authenticated_real,
  EvidenceOrigin.public_real,
  EvidenceOrigin.imported_real,
  EvidenceOrigin.manually_entered_real,
];
const NON_REAL_EVIDENCE: EvidenceOrigin[] = [
  EvidenceOrigin.fixture,
  EvidenceOrigin.mock,
  EvidenceOrigin.preview,
  EvidenceOrigin.unknown_legacy,
];

export function appEnvironment(env: NodeJS.ProcessEnv = process.env): ClearTradeEnvironment {
  const configured = env.APP_ENV?.trim().toLowerCase();
  if (configured) {
    if (configured === 'prod') return 'production';
    if (configured === 'dev') return env.EVIDENCE_DEMO_MODE === 'true' ? 'demo' : 'development';
    if (['test', 'development', 'demo', 'staging', 'production'].includes(configured)) return configured as ClearTradeEnvironment;
    throw new Error(`Unsupported APP_ENV ${configured}.`);
  }
  if (env.VERCEL_ENV === 'production') return 'production';
  if (env.VERCEL_ENV === 'preview') return 'staging';
  if (env.NODE_ENV === 'test') return 'test';
  if (env.NODE_ENV === 'production') return 'production';
  return env.EVIDENCE_DEMO_MODE === 'true' ? 'demo' : 'development';
}

export function isRealWorkflowEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const current = appEnvironment(env);
  return current === 'production' || current === 'staging';
}

export function allowedEvidenceOrigins(env: NodeJS.ProcessEnv = process.env): EvidenceOrigin[] {
  return isRealWorkflowEnvironment(env) ? REAL_EVIDENCE : [...REAL_EVIDENCE, ...NON_REAL_EVIDENCE];
}

export function importRecordEvidenceWhere(env: NodeJS.ProcessEnv = process.env): Prisma.ImportRecordWhereInput {
  return { evidence_origin: { in: allowedEvidenceOrigins(env) } };
}

export function buyerOutcomeEvidenceWhere(env: NodeJS.ProcessEnv = process.env): Prisma.BuyerOutcomeWhereInput {
  return { evidence_origin: { in: allowedEvidenceOrigins(env) } };
}

export function sanctionsEvidenceWhere(env: NodeJS.ProcessEnv = process.env): Prisma.SanctionsEntityWhereInput {
  return { evidence_origin: { in: allowedEvidenceOrigins(env) } };
}

export function tradeFlowEvidenceWhere(env: NodeJS.ProcessEnv = process.env): Prisma.TradeFlowWhereInput {
  return isRealWorkflowEnvironment(env)
    ? { source_mode: TradeSourceMode.authenticated }
    : { source_mode: { in: Object.values(TradeSourceMode) } };
}

export function unsafeEvidenceOrigins(origins: readonly EvidenceOrigin[]) {
  return origins.filter((origin) => NON_REAL_EVIDENCE.includes(origin));
}

export function nonRealEvidenceOrigins() { return [...NON_REAL_EVIDENCE]; }

export function assertFixtureMutationAllowed(action: string, env: NodeJS.ProcessEnv = process.env) {
  if (!isRealWorkflowEnvironment(env)) return;
  if (env.DANGEROUS_ALLOW_PRODUCTION_FIXTURES === 'I_UNDERSTAND_THIS_MUTATES_PRODUCTION') return;
  throw new Error(`${action} is disabled in ${appEnvironment(env)}. Set DANGEROUS_ALLOW_PRODUCTION_FIXTURES=I_UNDERSTAND_THIS_MUTATES_PRODUCTION only for an explicitly approved destructive fixture operation.`);
}

export function assertVerificationEnvironment(script: string, env: NodeJS.ProcessEnv = process.env) {
  if (isRealWorkflowEnvironment(env)) throw new Error(`${script} refuses to run against a ${appEnvironment(env)} database.`);
}

export function outcomeOriginForRuntime(env: NodeJS.ProcessEnv = process.env): EvidenceOrigin {
  const current = appEnvironment(env);
  const entrypoint=process.argv[1]?.split(/[\\/]/).at(-1)??'';
  if (current === 'test' || current === 'demo' || /^verify(?:-|\.)/.test(entrypoint)) return EvidenceOrigin.fixture;
  return EvidenceOrigin.manually_entered_real;
}

export function importOriginToClientMode(origin: EvidenceOrigin): TradeSourceMode {
  switch (origin) {
    case EvidenceOrigin.fixture: return TradeSourceMode.fixture;
    case EvidenceOrigin.mock: return TradeSourceMode.mock;
    case EvidenceOrigin.preview: return TradeSourceMode.preview;
    case EvidenceOrigin.public_real: return TradeSourceMode.public_real;
    case EvidenceOrigin.imported_real: return TradeSourceMode.imported_real;
    case EvidenceOrigin.manually_entered_real: return TradeSourceMode.manually_entered_real;
    case EvidenceOrigin.authenticated_real: return TradeSourceMode.authenticated;
    default: return TradeSourceMode.legacy_unknown;
  }
}

export function tradeSourceModeToEvidenceOrigin(mode: TradeSourceMode): EvidenceOrigin {
  switch (mode) {
    case TradeSourceMode.fixture: return EvidenceOrigin.fixture;
    case TradeSourceMode.mock: return EvidenceOrigin.mock;
    case TradeSourceMode.preview: return EvidenceOrigin.preview;
    case TradeSourceMode.authenticated: return EvidenceOrigin.authenticated_real;
    case TradeSourceMode.public_real: return EvidenceOrigin.public_real;
    case TradeSourceMode.imported_real: return EvidenceOrigin.imported_real;
    case TradeSourceMode.manually_entered_real: return EvidenceOrigin.manually_entered_real;
    default: return EvidenceOrigin.unknown_legacy;
  }
}
