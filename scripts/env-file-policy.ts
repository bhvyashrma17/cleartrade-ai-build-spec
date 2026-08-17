/**
 * Local env-file policy: `.env.local` is the only local configuration file.
 *
 * `.env` keeps reappearing in this checkout, and it is not a harmless duplicate. Next.js loads
 * BOTH files and gives `.env.local` precedence, while the `tsx`-based npm scripts are pointed
 * at `.env.local` explicitly — so a stray `.env` is read by neither in the way its author
 * expects. What actually happens is worse than being ignored: it silently supplies any
 * variable `.env.local` happens to omit, so the app runs on a blend of two files that no
 * single file describes. The last two occurrences were stale snapshots missing seven provider
 * mode variables, which is exactly the drift that makes "works on my machine" unreproducible.
 *
 * Kept as a pure function over an existence predicate so it is testable without touching the
 * filesystem, and so `env-check` can report it as a hard error rather than a warning.
 *
 * Scoped to non-real environments deliberately. Staging and production receive their
 * configuration from the platform (Railway Variables), never from a file in the image, so
 * there is nothing for this rule to protect there — and adding a new way for a real
 * deployment to fail closed on a file that should not exist anyway would be a regression, not
 * a safeguard.
 */

export interface EnvFilePolicyProblem {
  /** Stable identifier so callers can distinguish this from a missing-variable error. */
  code: 'prohibited_env_file';
  message: string;
}

/**
 * @param exists  predicate over a repo-root-relative filename
 * @param isRealEnvironment  true for staging/production, where this rule does not apply
 */
export function envFilePolicyProblem(
  exists: (file: string) => boolean,
  isRealEnvironment: boolean,
): EnvFilePolicyProblem | null {
  if (isRealEnvironment) return null;
  if (!exists('.env')) return null;

  // The remedy differs depending on whether the authoritative file is also present, and a
  // message that names the wrong remedy is worse than a generic one.
  const message = exists('.env.local')
    ? '.env is prohibited; use .env.local for local development. Both files exist, so .env is silently supplying any variable .env.local omits — move anything you still need into .env.local and delete .env.'
    : '.env is prohibited; use .env.local for local development. Rename it: mv .env .env.local (then chmod 600 .env.local).';

  return { code: 'prohibited_env_file', message };
}
