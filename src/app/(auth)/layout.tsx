import Link from 'next/link';
import { BrandMark } from '@/components/brand/BrandMark';
import { Wordmark } from '@/components/brand/Wordmark';

/**
 * The signed-out shell.
 *
 * Sign-in was the one screen in the product with no brand on it at all: a white card
 * floating on grey, headed by the string "ClearTrade AI" set in bold interface sans. It
 * is also, for anyone invited into a workspace, the first thing they ever see of the
 * product — so it now carries the lockup and the tagline, and the card is framed rather
 * than shadowed so it reads as a document rather than a modal.
 *
 * The pages inside render only their card; the ground, the mark and the footer live here
 * so the three of them (sign in, register, accept invitation) cannot drift apart again.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-ground px-4 py-12">
      <BrandMark size={620} className="pointer-events-none absolute -bottom-40 -left-44 text-bone opacity-[0.03]" />
      <div className="animate-fade-rise relative w-full max-w-md">
        <Link href="/" className="focus-visible-ring -m-1 mb-8 inline-block p-1" aria-label="ClearTrade — home">
          <Wordmark />
        </Link>
        {children}
        <p className="mt-8 text-center text-xs text-muted">Structured exports. Zero chaos.</p>
      </div>
    </main>
  );
}
