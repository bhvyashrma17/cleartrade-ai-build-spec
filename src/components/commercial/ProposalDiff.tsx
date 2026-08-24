import { StatusChip } from '@/components/ui';
import type { ProposalFieldDiff } from '@/lib/commercial';

/**
 * Version compare — EXP-10-AC02 and AGT-05 both require changed fields to be visually
 * identifiable. A changed row is marked with a chip and a label, never colour alone
 * (docs/03 §2), and the previous value stays on screen so "what changed" is legible
 * without opening the older version.
 */
export function ProposalDiff({
  diff,
  currentVersion,
  previousVersion,
}: {
  diff: ProposalFieldDiff[];
  currentVersion: number;
  previousVersion: number | null;
}) {
  const changedCount = diff.filter((d) => d.changed).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-primary">
          {previousVersion ? `What changed in v${currentVersion}` : `Terms in v${currentVersion}`}
        </h2>
        {previousVersion ? (
          <StatusChip
            label={changedCount === 0 ? 'No changes' : `${changedCount} field${changedCount === 1 ? '' : 's'} changed`}
            tone={changedCount === 0 ? 'neutral' : 'warning'}
            icon={changedCount === 0 ? 'dot' : 'alert'}
            size="sm"
          />
        ) : null}
      </div>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        {previousVersion
          ? `Compared against version ${previousVersion}.`
          : 'This is the first proposed version, so there is nothing to compare it against yet.'}
      </p>

      {/* A scroll container that only a mouse or a finger can move is content a keyboard
          user cannot reach at all. `tabIndex={0}` makes it focusable so arrow keys scroll
          it, and the role + label mean it is announced as a region rather than as an
          unexplained focus stop (axe: scrollable-region-focusable). */}
      <div
        className="focus-visible-ring mt-4 overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label="Proposal comparison, scrollable"
      >
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead className="text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="pb-2">Term</th>
              {previousVersion ? <th className="pb-2">Previous (v{previousVersion})</th> : null}
              <th className="pb-2">Current (v{currentVersion})</th>
            </tr>
          </thead>
          <tbody>
            {diff.map((row) => (
              <tr
                key={row.field}
                className={
                  row.changed
                    ? 'border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)]'
                    : 'border-t border-[var(--color-border)]'
                }
              >
                <td className="py-2.5 pr-3 align-top">
                  <span className="font-medium text-primary">{row.label}</span>
                  {row.changed ? (
                    <span className="ml-2 align-middle">
                      <StatusChip label="Changed" tone="warning" icon="alert" size="sm" />
                    </span>
                  ) : null}
                </td>
                {previousVersion ? (
                  <td className="py-2.5 pr-3 align-top text-[var(--color-text-secondary)]">
                    {row.previous ?? <span className="text-[var(--color-text-muted)]">Not set</span>}
                  </td>
                ) : null}
                <td className="py-2.5 align-top text-primary">
                  {row.current ?? <span className="text-[var(--color-text-muted)]">Not set</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
