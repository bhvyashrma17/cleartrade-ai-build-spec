/**
 * Email domains nobody can receive mail at (RFC 2606, RFC 6761): the `.test`, `.example`, `.invalid`
 * and `.localhost` top-level domains and the `example.com`, `example.net` and `example.org` names.
 * An account on one of them is a test account by definition, so an operator can remove it from
 * production without having to judge whose it is (docs/39 §6, E-049).
 */
export const RESERVED_TEST_TLDS = ['.test', '.example', '.invalid', '.localhost'] as const;
export const RESERVED_TEST_DOMAINS = ['example.com', 'example.net', 'example.org'] as const;

export function isReservedTestEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split('@').pop() ?? '';
  if (!domain || !email.includes('@')) return false;
  return RESERVED_TEST_TLDS.some((tld) => domain === tld.slice(1) || domain.endsWith(tld)) || (RESERVED_TEST_DOMAINS as readonly string[]).includes(domain);
}
