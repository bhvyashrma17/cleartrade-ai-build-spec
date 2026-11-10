/**
 * Shape checks a real Singapore First Schedule always passes (D-029): applied by the nightly refresh
 * before it saves a copy, and by the saved-copy builder (E-067). Pure, so a script can run them
 * without loading a database module.
 */
import type { SingaporeTariffLine } from './singapore-bundle';

export interface SingaporeQualificationCheck { key: string; passed: boolean; detail: string }

const startsWith = (lines: ReadonlyMap<string, SingaporeTariffLine>, prefix: string) => [...lines.values()].filter((line) => line.code.startsWith(prefix));

/**
 * Checks a real Singapore First Schedule always passes. They test shape, not amounts, so a budget
 * that changes a rate does not fail them; a page that parsed into the wrong columns does.
 */
export function qualifySingaporeTariff(lines: ReadonlyMap<string, SingaporeTariffLine>, previous: { tariff_line_count: number } | null): { passed: boolean; checks: SingaporeQualificationCheck[] } {
  const checks: SingaporeQualificationCheck[] = [];
  const total = lines.size;
  const nonDutiable = [...lines.values()].filter((line) => line.non_dutiable).length;
  const share = total ? nonDutiable / total : 0;
  checks.push({ key: 'mostly_duty_free', passed: share >= 0.9, detail: `${nonDutiable} of ${total} lines (${(share * 100).toFixed(1)}%) are not dutiable; at least 90% expected.` });
  const rice = startsWith(lines, '1006');
  checks.push({ key: 'rice_not_dutiable', passed: rice.length > 0 && rice.every((line) => line.non_dutiable), detail: `${rice.length} rice lines (1006), ${rice.filter((line) => !line.non_dutiable).length} dutiable; none expected.` });
  for (const [key, prefix, label] of [['liquor_dutiable', '2203', 'beer and stout (2203)'], ['tobacco_dutiable', '24', 'tobacco (24)'], ['motor_cars_dutiable', '8703', 'motor cars (8703)'], ['petrol_dutiable', '2710', 'petroleum oils (2710)']] as const) {
    const found = startsWith(lines, prefix);
    const dutiable = found.filter((line) => !line.non_dutiable).length;
    checks.push({ key, passed: dutiable > 0, detail: `${found.length} ${label} lines, ${dutiable} dutiable; at least one expected.` });
  }
  if (previous && previous.tariff_line_count > 0) {
    const drift = Math.abs(total - previous.tariff_line_count) / previous.tariff_line_count;
    checks.push({ key: 'line_count_steady', passed: drift <= 0.1, detail: `${total} lines against ${previous.tariff_line_count} in the release in use (${(drift * 100).toFixed(1)}% apart; at most 10%).` });
  }
  return { passed: checks.every((check) => check.passed), checks };
}
