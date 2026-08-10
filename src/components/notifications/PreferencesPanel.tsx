'use client';

/**
 * EXP-17 Preferences. A non-disableable category renders its toggles locked (not
 * hidden) with the reason inline — "Critical legal/security notifications may be
 * non-disableable" must be visible as a stated fact, not an absence.
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiClientError, apiGet, apiPatch } from '@/lib/api-client';

interface PreferenceRow {
  category: string;
  label: string;
  description: string;
  disableable: boolean;
  email_enabled: boolean;
  in_app_enabled: boolean;
}

function Toggle({ checked, disabled, onChange, label }: { checked: boolean; disabled: boolean; onChange: () => void; label: string }) {
  return (
    <label className={`flex items-center gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="focus-visible-ring rounded"
      />
      {label}
    </label>
  );
}

export function PreferencesPanel() {
  const [rows, setRows] = useState<PreferenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ data: PreferenceRow[] }>('/api/v1/notification-preferences');
      setRows(res.data);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not load preferences.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPrefs();
  }, [fetchPrefs]);

  const toggle = async (category: string, channel: 'email' | 'in_app', current: boolean) => {
    const key = `${category}:${channel}`;
    setSavingKey(key);
    setRows((prev) =>
      prev.map((r) => (r.category === category ? { ...r, [channel === 'email' ? 'email_enabled' : 'in_app_enabled']: !current } : r)),
    );
    try {
      await apiPatch('/api/v1/notification-preferences', { category, channel, enabled: !current });
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save that preference.');
      await fetchPrefs();
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Preferences</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Choose which categories reach you by email and in-app.</p>

      {error ? <p className="mt-2 text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      {loading ? (
        <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Loading…</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((r) => (
            <li key={r.category} className="rounded-md border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-primary">{r.label}</p>
                  <p className="text-xs text-[var(--color-text-secondary)]">{r.description}</p>
                </div>
                {!r.disableable ? (
                  <span className="shrink-0 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)]">
                    Always on
                  </span>
                ) : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-4">
                <Toggle
                  checked={r.email_enabled}
                  disabled={!r.disableable || savingKey === `${r.category}:email`}
                  onChange={() => void toggle(r.category, 'email', r.email_enabled)}
                  label="Email"
                />
                <Toggle
                  checked={r.in_app_enabled}
                  disabled={!r.disableable || savingKey === `${r.category}:in_app`}
                  onChange={() => void toggle(r.category, 'in_app', r.in_app_enabled)}
                  label="In-app"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
