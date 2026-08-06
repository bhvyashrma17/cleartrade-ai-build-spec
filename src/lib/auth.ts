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
import { UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { forbidden, unauthenticated } from '@/lib/errors';
import type { Principal, PortalRoot } from '@/types';

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
  providers: [
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
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.exporter_org_id = user.exporter_org_id;
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

/** The portal a role lands in after login. */
export function portalForRole(role: UserRole): PortalRoot {
  if (EXPORTER_ROLES.includes(role)) return '/app';
  if (role === UserRole.agent) return '/agent';
  return '/ops';
}

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

export function canAccessPortal(role: UserRole, portal: PortalRoot): boolean {
  return portalForRole(role) === portal;
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
    },
  });
  if (!user || !user.is_active) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    exporter_org_id: user.exporter_org_id,
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
