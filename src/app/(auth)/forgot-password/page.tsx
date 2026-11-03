import { ForgotPasswordForm } from './ForgotPasswordForm';

/** Ask for a password reset link (R-39). Answers the same way whether or not the email has an account. */
export default function ForgotPasswordPage() {
  return (
    <section className="rounded-xl border border-line-strong bg-surface p-6 sm:p-8">
      <h1 className="display text-title-page text-bone">Forgot your password?</h1>
      <p className="mt-3 text-sm text-muted">Enter your ClearTrade email. If it has a password, we&apos;ll send it a link to choose a new one.</p>
      <div className="mt-7"><ForgotPasswordForm /></div>
    </section>
  );
}
