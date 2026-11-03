/**
 * Operator scripts that may write to production (docs/39) refuse unless the operator names the
 * database they mean: `--confirm-production=<fingerprint prefix>`, the same 12 characters every
 * operator script prints as `database_fingerprint`. A production env file picked up by mistake
 * therefore stops a script before it writes, and the refusal shows which database it would have
 * written to. Outside production the flag is refused too, so a command copied from the launch guide
 * cannot silently run somewhere else.
 */
export const PRODUCTION_CONFIRM_FLAG = '--confirm-production';

export interface DatabaseIdentity {
  environment: string;
  database_fingerprint: string;
}

export function productionConfirmationProblem(
  database: DatabaseIdentity,
  argv: readonly string[],
  script: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const production = database.environment === 'production' || env.DATABASE_ENVIRONMENT === 'production';
  const given = argv
    .filter((value) => value.startsWith(`${PRODUCTION_CONFIRM_FLAG}=`))
    .map((value) => value.slice(PRODUCTION_CONFIRM_FLAG.length + 1).trim());
  const prefix = database.database_fingerprint.slice(0, 12);
  if (!production) {
    return given.length > 0
      ? `${script}: ${PRODUCTION_CONFIRM_FLAG} was given, but this database is ${database.environment}, not production.`
      : null;
  }
  if (given.length !== 1 || given[0] !== prefix) {
    return `${script} writes to production only with ${PRODUCTION_CONFIRM_FLAG}=${prefix}. Check that this is the production fingerprint recorded for the session (docs/39 §2) before re-running.`;
  }
  return null;
}
