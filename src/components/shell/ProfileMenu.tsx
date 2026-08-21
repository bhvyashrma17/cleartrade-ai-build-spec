'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { UserRole } from '@prisma/client';
import { signOutFromSettings } from '@/app/app/settings/actions';
import { PROFILE_ROLE_LABELS, profileMenuDestinations, type ProfilePortal } from './profile-menu';

export function ProfileMenu({ name, email, portal, role }: { name: string | null; email: string; portal: ProfilePortal; role: UserRole }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const destinations = profileMenuDestinations(portal, role);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="focus-visible-ring flex min-h-9 max-w-44 items-center gap-2 rounded bg-white/10 px-2.5 text-left hover:bg-white/15"
      >
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-xs font-bold text-primary">
          {(name || email).trim().charAt(0).toUpperCase()}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-medium">{name || 'Profile'}</span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 16 16" className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m4 6 4 4 4-4" /></svg>
      </button>

      {open ? (
        <div id={menuId} role="menu" aria-label="Account menu" className="absolute right-0 mt-2 w-[min(19rem,calc(100vw-2rem))] rounded-lg border border-[var(--color-border)] bg-surface p-2 text-primary shadow-raised">
          <div className="px-3 py-2">
            <p className="truncate font-semibold">{name || 'ClearTrade user'}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{email}</p>
          </div>
          <div className="my-1 border-t border-[var(--color-border)]" />
          <Link role="menuitem" href={destinations.workspace} onClick={() => setOpen(false)} className="focus-visible-ring block rounded px-3 py-2 hover:bg-surface-muted">
            <span className="block text-sm font-medium">Workspace</span>
            <span className="block text-xs text-[var(--color-text-secondary)]">{PROFILE_ROLE_LABELS[role]}</span>
          </Link>
          <Link role="menuitem" href={destinations.personalSettings} onClick={() => setOpen(false)} className="focus-visible-ring block rounded px-3 py-2 text-sm font-medium hover:bg-surface-muted">
            {destinations.adminSettings ? 'Personal settings' : 'Settings'}
          </Link>
          {destinations.adminSettings ? (
            <Link role="menuitem" href={destinations.adminSettings} onClick={() => setOpen(false)} className="focus-visible-ring block rounded px-3 py-2 text-sm font-medium hover:bg-surface-muted">Admin settings</Link>
          ) : null}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <form action={signOutFromSettings}>
            <button role="menuitem" type="submit" className="focus-visible-ring block w-full rounded px-3 py-2 text-left text-sm font-medium hover:bg-surface-muted">Sign out</button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
