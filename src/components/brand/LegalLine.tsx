import clsx from 'clsx';

/**
 * The company behind ClearTrade and a mailbox on its own domain (owner, 2–3 Nov 2026), on every
 * page: the homepage, the sign-in shell, all three portals (through `AppShell`) and the 404 and
 * error pages. One component, so the line cannot drift between them.
 *
 * A `div`, not a `footer`: the homepage already wraps it in its own footer, and a footer may not
 * contain another. Each placement supplies the landmark.
 */
export const COMPANY_LEGAL_NAME = 'Trade Flux AI Solutions LLP';
export const COMPANY_CONTACT_EMAIL = 'hello@cleartrade.in';

export function LegalLine({ className }: { className?: string }) {
  return (
    <div className={clsx('text-xs text-muted', className)}>
      <p>
        © {new Date().getFullYear()} {COMPANY_LEGAL_NAME} · ClearTrade
      </p>
      <p className="mt-1">
        <a href={`mailto:${COMPANY_CONTACT_EMAIL}`} className="underline underline-offset-2 hover:text-bone">
          {COMPANY_CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
