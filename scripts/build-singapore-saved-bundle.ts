/**
 * E-067 — Singapore's tariff from pages a person saved in a browser (D-029's saved-copy route, D-040).
 *
 * Singapore Statutes Online refuses scripts with HTTP 403, from Railway and from the owner's machine
 * alike, even inside its 03:00–07:00 SGT automation window. A person opening the six pages in a
 * browser and saving them is ordinary use, so this builds the same bundle the nightly acquisition
 * would, from those files, with no network access and no window. The bundle is then imported with
 * the command it prints (`import-retained-authority-release.ts --family=SG`).
 *
 * Save each page with the browser's "Save Page As" (Chrome: "Webpage, Complete"), under these names,
 * into one folder; for the three SSO instruments use "Select All" then "Print - HTML" first:
 *
 *   customs-duties-order-current.html  https://sso.agc.gov.sg/SL/CA1960-OR4?ProvIds=Sc4-XX-Sc4-&ViewType=Print
 *   s49-2026.html                      https://sso.agc.gov.sg/SL-Supp/S49-2026/Published/20260130?DocDate=20260130&ViewType=Print
 *   s67-2026.html                      https://sso.agc.gov.sg/SL-Supp/S67-2026/Published/20260212?DocDate=20260212&ViewType=Print
 *   terms-of-use.html                  https://sso.agc.gov.sg/Terms-of-Use
 *   classification.html                https://www.customs.gov.sg/doing-business/business-resources/hs-classification-of-goods/classifying-my-products/
 *   dutiable-goods.html                https://www.customs.gov.sg/doing-business/valuation-duties-and-fees/duties-and-dutiable-goods/duties-and-dutiable-goods-overview/
 *
 *   npx tsx scripts/build-singapore-saved-bundle.ts --dir=<folder> --out=<file.zip> [--saved-on=YYYY-MM-DD]
 *
 * `--saved-on` defaults to the Singapore date the order page's file was last written. The schedule
 * must pass the nightly refresh's shape checks before the bundle is written. Reads no database and
 * prints no secrets.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildSingaporeSavedCopyBundle, SINGAPORE_ORDER_URL, SINGAPORE_SAVED_PAGES } from '@/lib/market-access/providers/singapore-acquisition';
import { readSingaporeAuthorityBundle } from '@/lib/market-access/providers/singapore-bundle';
import { qualifySingaporeTariff } from '@/lib/market-access/providers/singapore-qualification';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();

function required(name: string) {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

const singaporeDate = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(value);

async function main() {
  const dir = required('dir');
  const out = required('out');
  const pages = Object.fromEntries(SINGAPORE_SAVED_PAGES.map(({ file }) => [file, readFileSync(join(dir, file))]));
  const orderSavedAt = statSync(join(dir, SINGAPORE_SAVED_PAGES[0]!.file)).mtime;
  const savedOn = arg('saved-on') ?? singaporeDate(orderSavedAt);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(savedOn)) throw new Error('--saved-on must be YYYY-MM-DD.');
  const savedAt = arg('saved-on') ? new Date(`${savedOn}T00:00:00+08:00`) : orderSavedAt;
  const release = `sso-saved-${savedOn}`;

  const bytes = await buildSingaporeSavedCopyBundle({ release_identifier: release, saved_at: savedAt, pages });
  const bundle = await readSingaporeAuthorityBundle({ bytes, release_identifier: release });
  // The same shape checks the nightly refresh applies before it saves a copy (D-029).
  const qualification = qualifySingaporeTariff(bundle.lines, null);
  if (!qualification.passed) {
    throw new Error(`The saved schedule fails qualification: ${qualification.checks.filter((check) => !check.passed).map((check) => `${check.key} (${check.detail})`).join('; ')}`);
  }
  writeFileSync(out, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const lines = [...bundle.lines.values()];
  console.log(JSON.stringify({
    file: out, sha256, release_identifier: release, saved_on: savedOn, consolidated_as_at: bundle.consolidated_as_at,
    tariff_line_count: lines.length,
    qualification: qualification.checks.map((check) => `${check.passed ? 'pass' : 'FAIL'} ${check.key}: ${check.detail}`),
    non_dutiable_lines: lines.filter((line) => line.non_dutiable).length,
    lines_without_an_official_rate: lines.filter((line) => !line.non_dutiable && [line.full_customs_duty, line.preferential_customs_duty, line.excise_duty].every((duty) => duty.kind === 'none')).length
      + lines.filter((line) => line.excise_duty.kind === 'unparsed').length,
    import_with: `npx tsx --env-file=<env> scripts/import-retained-authority-release.ts --family=SG --file=${out} --expect-sha256=${sha256} --release=${release} --reference-date=${savedOn} --retrieved-at=${savedOn} --source-url='${SINGAPORE_ORDER_URL}' --actor-email=<ops supervisor or admin> --activate`,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
