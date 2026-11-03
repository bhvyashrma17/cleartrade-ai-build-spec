import { ResetPasswordForm } from './ResetPasswordForm';

/** Choose a new password from a reset link (R-39). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <section className="rounded-xl border border-line-strong bg-surface p-6 sm:p-8">
      <h1 className="display text-title-page text-bone">Choose a new password</h1>
      <div className="mt-7"><ResetPasswordForm token={token ?? ''} /></div>
    </section>
  );
}
