/**
 * Load the developer's local env file for test runs.
 *
 * Next.js loads `.env.local` on its own, but `tsx`/Vitest do not, so tests have to ask.
 * `.env.local` is the convention (gitignored, machine-specific — see
 * docs/28-environment-configuration.md); `.env` is still accepted so a checkout that
 * predates the migration keeps running rather than failing with a confusing
 * "DATABASE_URL is required".
 *
 * First file found wins, matching Next's precedence. Returns the file used, or null when
 * neither exists — in CI that is normal, because the environment is injected directly.
 */
export function loadLocalEnvFile(): string | null {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile?.(file);
      return file;
    } catch {
      // Missing file: try the next candidate.
    }
  }
  return null;
}
