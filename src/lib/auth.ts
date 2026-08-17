/**
 * Auth.js (NextAuth v5) configuration + server-side principal helpers.
 *
 * Role routing per docs/01 §4: exporter -> /app, agent -> /agent, ops/admin -> /ops.
 *
 * The session carries `role` and `exporter_org_id` in the JWT, but nothing trusts the
 * token as authorization on its own — `requirePrincipal()` re-reads the user row so a
 * deactivated account or a changed role takes effect immediately, and every resource
 * check goes through src/lib/permissions.ts.
 */

import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import Apple from 'next-auth/providers/apple';
import { OrgTier, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { verifyGuestMintProof } from '@/lib/guest';
import { canAccessPortal, portalForRole } from '@/lib/permissions';
import { forbidden, unauthenticated } from '@/lib/errors';
import type { Principal, PortalRoot } from '@/types';
import {
  claimsForSocialAccount,
  isSocialProviderEnabled,
  isSocialProviderId,
  resolveSocialIdentity,
  type SocialProviderId,
} from '@/lib/social-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: UserRole;
      exporter_org_id: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    role: UserRole;
    exporter_org_id: string | null;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', error: '/login' },
  /**
   * Secure cookies in real environments (Phase 14).
   *
   * Auth.js infers this from the request URL, which is correct behind a well-configured
   * proxy but silently degrades to a non-Secure cookie if the app ever sees a plaintext
   * origin (a misconfigured load balancer, an internal health probe). Stating it explicitly
   * means a session cookie can never be issued without the Secure flag in staging or
   * production, regardless of how the request arrived.
   */
  useSecureCookies: ['production', 'staging'].includes(process.env.APP_ENV ?? ''),
  providers: [
    ...(isSocialProviderEnabled('google')
      ? [Google({
          clientId: process.env.AUTH_GOOGLE_ID!,
          clientSecret: process.env.AUTH_GOOGLE_SECRET!,
          authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } },
        })]
      : []),
    ...(isSocialProviderEnabled('apple')
      ? [Apple({
          clientId: process.env.AUTH_APPLE_ID!,
          clientSecret: process.env.AUTH_APPLE_SECRET!,
        })]
      : []),
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });
        // Same failure for unknown email and wrong password — do not disclose which.
        if (!user || !user.is_active) return null;

        // A null hash means the row cannot be logged into at all — a guest, until it
        // registers. This must come before bcrypt.compare, which throws on a null hash
        // rather than returning false (a 500 instead of a clean credential denial).
        if (!user.password_hash) return null;

        const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
        if (!ok) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          exporter_org_id: user.exporter_org_id,
        };
      },
    }),

    /**
     * Guest sessions.
     *
     * A guest is issued the SAME kind of JWT session as a real login — that is what
     * keeps `getPrincipal()`, `tenantScope()` and every permission predicate working
     * unchanged, and why the product has no unauthenticated code path.
     *
     * This provider does not mint anything. The caller (the discovery route) checks and
     * consumes the IP quota first, mints the row, and then presents a server-issued
     * proof. Accepting a bare `userId` here would be an impersonation hole: anyone could
     * request a session for an arbitrary account, including a paying one.
     */
    Credentials({
      id: 'guest',
      name: 'Guest session',
      credentials: { userId: {}, proof: {} },
      async authorize(raw) {
        const userId = typeof raw?.userId === 'string' ? raw.userId : null;
        const proof = typeof raw?.proof === 'string' ? raw.proof : null;
        if (!userId || !proof) return null;
        if (!verifyGuestMintProof(userId, proof)) return null;

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            exporter_org_id: true,
            is_active: true,
            password_hash: true,
            exporter_org: { select: { tier: true } },
          },
        });
        if (!user || !user.is_active) return null;

        // Defence in depth: even with a valid proof, this provider may only ever issue a
        // session for a genuine guest row. A guest has no password and a guest-tier org,
        // so anything else here means the proof was minted for the wrong kind of user.
        if (user.password_hash !== null) return null;
        if (user.exporter_org?.tier !== OrgTier.guest) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          exporter_org_id: user.exporter_org_id,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (!isSocialProviderId(account?.provider)) return true;
      if (!isSocialProviderEnabled(account.provider)) {
        return `/login?error=OAuthProviderDisabled&provider=${account.provider}`;
      }
      const provider = account.provider as SocialProviderId;
      const resolved = await resolveSocialIdentity({
        provider,
        providerAccountId: account.providerAccountId,
        email: typeof profile?.email === 'string' ? profile.email : null,
        emailVerified:
          typeof profile?.email_verified === 'boolean'
            ? profile.email_verified
            : provider === 'apple'
              ? true
              : null,
        name: typeof profile?.name === 'string' ? profile.name : null,
        correlationId: crypto.randomUUID(),
      });
      if (resolved.ok) return true;

      if (resolved.reason === 'missing_email' || resolved.reason === 'email_not_verified') {
        return `/login?error=OAuthEmailUnavailable&provider=${provider}`;
      }
      if (resolved.reason === 'inactive_account') {
        // A deliberate ClearTrade error code, not Auth.js's AccessDenied: an admin
        // deactivating an account is a different situation from a user cancelling the
        // consent screen, and "sign-in was cancelled or denied" would be misleading here.
        return `/login?error=SocialAccountDisabled&provider=${provider}`;
      }
      return `/login?error=OAuthEmailConflict&provider=${provider}`;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.exporter_org_id = user.exporter_org_id;
      }
      if (isSocialProviderId(account?.provider) && typeof account.providerAccountId === 'string') {
        const claims = await claimsForSocialAccount(account.provider, account.providerAccountId);
        if (claims) {
          token.id = claims.id;
          token.role = claims.role;
          token.exporter_org_id = claims.exporter_org_id;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as UserRole;
      session.user.exporter_org_id = (token.exporter_org_id as string | null) ?? null;
      return session;
    },
  },
});

// ---------------------------------------------------------------------------
// Role -> portal routing
// ---------------------------------------------------------------------------

export const EXPORTER_ROLES: UserRole[] = [UserRole.exporter_owner, UserRole.exporter_member];
export const OPS_ROLES: UserRole[] = [UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin];

/**
 * The portal a role lands in after login.
 *
 * Defined in permissions.ts (pure role authorization, no session dependency) and re-exported
 * here so existing `@/lib/auth` call sites are unchanged.
 */
export { portalForRole, canAccessPortal };

/** Post-login landing route (docs/12 screen registry). */
export function homeRouteForRole(role: UserRole): string {
  switch (portalForRole(role)) {
    case '/app':
      return '/app/overview';
    case '/agent':
      return '/agent';
    case '/ops':
      return '/ops';
  }
}

// ---------------------------------------------------------------------------
// Server-side principal
// ---------------------------------------------------------------------------

/** The signed-in principal, or null. Re-reads the user row — the JWT is a hint, not a grant. */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      exporter_org_id: true,
      is_active: true,
      // Tier is read from the org on every request for the same reason the role is:
      // the JWT is a hint, not a grant. A downgrade (or an expired guest) must take
      // effect immediately, not at the next login.
      exporter_org: { select: { tier: true } },
    },
  });
  if (!user || !user.is_active) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exporter_org_id: user.exporter_org_id,
    // Staff have no tenant and are governed by the role matrix alone, so they read as
    // `paid` — the tier gate must never fire on an agent or ops principal.
    tier: user.exporter_org?.tier ?? OrgTier.paid,
  };
}

/** Throws UNAUTHENTICATED (401) when there is no valid session. */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) throw unauthenticated();
  return principal;
}

/** Portal-level guard used by each portal layout. Throws FORBIDDEN (403). */
export async function requirePortalAccess(portal: PortalRoot): Promise<Principal> {
  const principal = await requirePrincipal();
  if (!canAccessPortal(principal.role, portal)) {
    throw forbidden('This area is not available for your role.');
  }
  return principal;
}

/**
 * An exporter principal with a guaranteed tenant key.
 *
 * An exporter user without exporter_org_id is a data defect, not an edge case — it would
 * mean an unscoped query, so it fails closed.
 */
export async function requireExporterPrincipal(): Promise<Principal & { exporter_org_id: string }> {
  const principal = await requirePortalAccess('/app');
  if (!principal.exporter_org_id) {
    throw forbidden('Your account is not linked to an exporter organization.');
  }
  return principal as Principal & { exporter_org_id: string };
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
