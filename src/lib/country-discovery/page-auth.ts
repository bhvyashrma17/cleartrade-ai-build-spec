/**
 * The exporter principal for a country-discovery page, or a redirect to sign-in.
 *
 * `requireExporterPrincipal()` throws for an anonymous visitor, which Next renders as a 500.
 * That is tolerable on a deep page reached only from inside the app, but `/app/products` is now
 * the journey's entry point and is linked from the nav, so a bookmarked or shared link must
 * take a signed-out visitor to sign-in rather than to an error page. `/app/overview` already
 * establishes this pattern; these pages follow it.
 */
import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/auth';
import type { Principal } from '@/types';

export async function requireDiscoveryPrincipal(): Promise<Principal & { exporter_org_id: string }> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  if (!principal.exporter_org_id) redirect('/app/overview');
  return principal as Principal & { exporter_org_id: string };
}
