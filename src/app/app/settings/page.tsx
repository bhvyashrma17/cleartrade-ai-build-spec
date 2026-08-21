import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ApiError } from '@/lib/errors';
import { requirePrincipal } from '@/lib/auth';
import { loadUserSettings } from '@/lib/user-settings';
import { signOutFromSettings } from './actions';

function Card({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card md:p-6">
      <h2 className="text-lg font-semibold text-primary">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-[var(--color-border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <dt className="text-sm text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="mt-1 font-medium text-primary">{value}</dd>
    </div>
  );
}

function UnavailableRow({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[var(--color-border)] py-4 first:border-t-0 first:pt-0 last:pb-0">
      <div>
        <p className="font-medium text-primary">{title}</p>
        <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{description}</p>
      </div>
      <span className="shrink-0 text-xs font-medium text-[var(--color-text-muted)]">Not available yet</span>
    </div>
  );
}

export default async function SettingsPage() {
  let principal;
  try {
    principal = await requirePrincipal();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?callbackUrl=/app/settings');
    throw error;
  }
  const settings = await loadUserSettings(principal);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-primary">Settings</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Manage your account, preferences, and support options.</p>
      </header>

      <div className="grid gap-6 md:grid-cols-[12rem_minmax(0,1fr)]">
        <aside className="self-start rounded-lg border border-[var(--color-border)] bg-surface p-3 shadow-card md:sticky md:top-20">
          <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Preferences</p>
          <nav aria-label="Settings sections" className="flex gap-1 md:flex-col">
            <a href="#account" className="focus-visible-ring rounded bg-surface-muted px-3 py-2 text-sm font-medium text-primary">Account</a>
            <a href="#about" className="focus-visible-ring rounded px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-muted hover:text-primary">About</a>
          </nav>
        </aside>

        <div className="space-y-4">
          <Card id="account" title="Account">
            <dl>
              <ReadOnlyRow label="Email" value={settings.account.email} />
              <ReadOnlyRow label="Name" value={settings.account.name} />
              <ReadOnlyRow label="Account type" value={settings.account.roleLabel} />
            </dl>
            <p className="mt-4 text-xs text-[var(--color-text-muted)]">Account details are read-only. ClearTrade does not currently provide a verified email or profile-change flow.</p>
          </Card>

          {settings.workspace ? (
            <>
              <Card title="Subscription">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm text-[var(--color-text-secondary)]">Current plan</p>
                    <p className="mt-1 text-lg font-semibold text-primary">{settings.workspace.planLabel}</p>
                  </div>
                  {settings.workspace.tier !== 'paid' ? <Link href="/app/billing" className="focus-visible-ring rounded bg-action px-4 py-2 text-sm font-semibold text-primary hover:brightness-95">Upgrade</Link> : null}
                </div>
              </Card>
              <Card title="Workspace">
                <dl>
                  <ReadOnlyRow label="Workspace" value={settings.workspace.name} />
                  <ReadOnlyRow label="Role" value={settings.account.roleLabel.replace('Exporter ', '')} />
                </dl>
                <Link href="/app/notifications" className="focus-visible-ring mt-5 inline-flex rounded text-sm font-semibold text-[var(--color-action-text)] hover:underline">Manage business profile</Link>
              </Card>
            </>
          ) : null}

          {settings.signInMethods.length > 0 ? (
            <Card title="Security">
              <ReadOnlyRow label="Sign-in method" value={settings.signInMethods.join(', ')} />
            </Card>
          ) : null}

          <Card title="Session">
            <p className="text-sm text-[var(--color-text-secondary)]">Signed in as</p>
            <p className="mt-1 font-medium text-primary">{settings.account.email}</p>
            <form action={signOutFromSettings} className="mt-5">
              <button type="submit" className="focus-visible-ring min-h-10 rounded border border-[var(--color-border-strong)] bg-surface px-4 text-sm font-semibold text-primary hover:bg-surface-muted">Sign out</button>
            </form>
          </Card>

          <Card id="about" title="About">
            <UnavailableRow title="Report a bug" description="Tell us what went wrong." />
            <UnavailableRow title="Privacy policy" description="Read how your data is handled." />
            <UnavailableRow title="Terms of service" description="Review ClearTrade's service terms." />
          </Card>
        </div>
      </div>
    </div>
  );
}
