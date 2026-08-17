import { CommitmentFeeStatus, OrgTier, Prisma, UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getFeePolicy } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export type SocialProviderId = 'google' | 'apple';

interface SocialProviderDefinition {
  id: SocialProviderId;
  label: string;
  clientIdEnv: string;
  clientSecretEnv: string;
}

const SOCIAL_PROVIDERS: readonly SocialProviderDefinition[] = [
  { id: 'google', label: 'Google', clientIdEnv: 'AUTH_GOOGLE_ID', clientSecretEnv: 'AUTH_GOOGLE_SECRET' },
  { id: 'apple', label: 'Apple', clientIdEnv: 'AUTH_APPLE_ID', clientSecretEnv: 'AUTH_APPLE_SECRET' },
] as const;

export interface SocialProviderState extends SocialProviderDefinition {
  enabled: boolean;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

export function socialProviderStates(env: NodeJS.ProcessEnv = process.env): SocialProviderState[] {
  return SOCIAL_PROVIDERS.map((provider) => ({
    ...provider,
    enabled: hasValue(env[provider.clientIdEnv]) && hasValue(env[provider.clientSecretEnv]),
  }));
}

export function isSocialProviderId(raw: string | null | undefined): raw is SocialProviderId {
  return raw === 'google' || raw === 'apple';
}

export function isSocialProviderEnabled(provider: SocialProviderId, env: NodeJS.ProcessEnv = process.env): boolean {
  return socialProviderStates(env).some((entry) => entry.id === provider && entry.enabled);
}

export function normalizeCallbackUrl(
  input: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = (input ?? '').trim();
  if (!value) return '/';

  if (value.startsWith('/') && !value.startsWith('//')) return value;

  try {
    const parsed = new URL(value);
    const allowedOrigins = new Set<string>([
      'http://localhost:3000',
      'https://localhost:3000',
    ]);
    if (hasValue(env.NEXT_PUBLIC_APP_URL)) {
      allowedOrigins.add(new URL(env.NEXT_PUBLIC_APP_URL!).origin);
    }
    if (!allowedOrigins.has(parsed.origin)) return '/';
    const suffix = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return suffix.startsWith('/') ? suffix : '/';
  } catch {
    return '/';
  }
}

function providerLabel(provider: string | null | undefined): string {
  return socialProviderStates().find((entry) => entry.id === provider)?.label ?? 'social sign-in';
}

export function loginErrorMessage(error: string | null | undefined, provider: string | null | undefined): string | null {
  const socialLabel = providerLabel(provider);
  switch (error) {
    case 'OAuthAccountNotLinked':
    case 'OAuthEmailConflict':
      return `This email is already registered with a different sign-in method. Use your existing login, then ask support to link ${socialLabel}.`;
    case 'OAuthEmailUnavailable':
      return `${socialLabel} did not return a usable verified email address. Use another sign-in method or update your provider account email settings.`;
    case 'OAuthProviderDisabled':
      return `${socialLabel} sign-in is not configured in this environment yet.`;
    case 'AccessDenied':
      return `${socialLabel} sign-in was cancelled or denied.`;
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
      return `${socialLabel} sign-in could not be completed. Please try again.`;
    case 'Configuration':
      return 'Authentication is temporarily unavailable. Please contact support.';
    default:
      return null;
  }
}

export interface ResolveSocialIdentityInput {
  provider: SocialProviderId;
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean | null;
  name: string | null;
  correlationId: string;
}

type ResolveSocialIdentityFailureReason =
  | 'missing_provider_account_id'
  | 'missing_email'
  | 'email_not_verified'
  | 'email_conflict'
  | 'inactive_account';

type ResolveSocialIdentityResult =
  | { ok: true; userId: string; role: UserRole; exporterOrgId: string | null; created: boolean }
  | { ok: false; reason: ResolveSocialIdentityFailureReason };

function displayNameForIdentity(name: string | null, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed.slice(0, 120);
  return email.split('@')[0].slice(0, 120) || 'ClearTrade user';
}

function organizationNameForIdentity(name: string, email: string): string {
  const companyBase = name.split(/\s+/)[0] || email.split('@')[0] || 'New';
  return `${companyBase.slice(0, 80)} Exports`;
}

/**
 * Map an external identity to a local user, provisioning one only when it is safe to.
 *
 * The ordering is the security property: a durable `(provider, provider_account_id)` binding
 * is checked FIRST, and email is only ever used to *refuse* provisioning, never to link. An
 * existing account with the same address is a conflict to report, not an account to adopt —
 * treating a provider's email claim as proof of ownership is the standard OAuth takeover.
 *
 * KNOWN LIMITATION — guest upgrade. `POST /api/v1/register` deliberately upgrades a guest's
 * existing ExporterOrg in place so their discovery history survives signup. This path cannot:
 * it has no trustworthy way, inside an OAuth callback, to prove the browser's guest session
 * belongs to the person who just authenticated with Google. So a guest who converts via social
 * sign-in gets a fresh tenant and loses that history. Documented in
 * docs/29-social-authentication.md §7 rather than papered over, because closing it is a
 * product decision about proof of ownership, not a coding detail.
 */
export async function resolveSocialIdentity(
  input: ResolveSocialIdentityInput,
  db = prisma,
): Promise<ResolveSocialIdentityResult> {
  const providerAccountId = input.providerAccountId.trim();
  if (!providerAccountId) return { ok: false, reason: 'missing_provider_account_id' };

  const linked = await db.authProviderAccount.findUnique({
    where: {
      provider_provider_account_id: {
        provider: input.provider,
        provider_account_id: providerAccountId,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          role: true,
          exporter_org_id: true,
          is_active: true,
        },
      },
    },
  });

  if (linked) {
    if (!linked.user.is_active) return { ok: false, reason: 'inactive_account' };
    return {
      ok: true,
      userId: linked.user.id,
      role: linked.user.role,
      exporterOrgId: linked.user.exporter_org_id,
      created: false,
    };
  }

  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  if (!normalizedEmail) return { ok: false, reason: 'missing_email' };
  if (input.provider === 'google' && input.emailVerified !== true) {
    return { ok: false, reason: 'email_not_verified' };
  }

  const existingByEmail = await db.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existingByEmail) return { ok: false, reason: 'email_conflict' };

  const feePolicy = await getFeePolicy();
  const userName = displayNameForIdentity(input.name, normalizedEmail);
  const orgName = organizationNameForIdentity(userName, normalizedEmail);

  try {
    const created = await db.$transaction(async (tx) => {
      const org = await tx.exporterOrg.create({
        data: {
          display_name: orgName,
          tier: OrgTier.free,
          commitment_fee_status: CommitmentFeeStatus.due,
          commitment_fee_amount: feePolicy.commitment_fee.amount,
          commitment_fee_currency: feePolicy.commitment_fee.currency,
          commitment_fee_policy_version: feePolicy.version,
          commitment_fee_due_at: new Date(),
        },
        select: { id: true, tier: true },
      });
      const user = await tx.user.create({
        data: {
          email: normalizedEmail,
          name: userName,
          password_hash: null,
          role: UserRole.exporter_owner,
          exporter_org_id: org.id,
        },
        select: { id: true, role: true, exporter_org_id: true },
      });
      await tx.authProviderAccount.create({
        data: {
          user_id: user.id,
          provider: input.provider,
          provider_account_id: providerAccountId,
          provider_email: normalizedEmail,
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: {
          id: user.id,
          email: normalizedEmail,
          name: userName,
          role: user.role,
          exporter_org_id: user.exporter_org_id,
          tier: org.tier,
        },
        action: AUDIT_ACTIONS.create,
        object_type: 'user',
        object_id: user.id,
        exporter_org_id: user.exporter_org_id,
        after_summary: {
          auth_provider: input.provider,
          via_oauth: true,
        },
        correlation_id: input.correlationId,
      });
      return user;
    });

    return {
      ok: true,
      userId: created.id,
      role: created.role,
      exporterOrgId: created.exporter_org_id,
      created: true,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, reason: 'email_conflict' };
    }
    throw error;
  }
}

export async function claimsForSocialAccount(
  provider: SocialProviderId,
  providerAccountId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ id: string; role: UserRole; exporter_org_id: string | null } | null> {
  const linked = await db.authProviderAccount.findUnique({
    where: {
      provider_provider_account_id: {
        provider,
        provider_account_id: providerAccountId,
      },
    },
    select: {
      user: {
        select: {
          id: true,
          role: true,
          exporter_org_id: true,
          is_active: true,
        },
      },
    },
  });
  if (!linked?.user || !linked.user.is_active) return null;
  return {
    id: linked.user.id,
    role: linked.user.role,
    exporter_org_id: linked.user.exporter_org_id,
  };
}
