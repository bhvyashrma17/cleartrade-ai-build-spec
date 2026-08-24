'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import type { NavItem, Portal } from './AppShell';

/**
 * ⌘K — go anywhere, from anywhere.
 *
 * This exists because removing the sidebar has to *add* something, not just take one
 * away. A sidebar's real job is not decoration, it is "show me everything I can reach";
 * the palette does that job better — it covers every destination the current
 * role and tier can actually reach, it is reachable without moving your hands off the
 * keyboard, and it costs zero pixels until it is asked for.
 *
 * The trigger stays visible and shows its own shortcut, because a keyboard feature nobody
 * can see is a keyboard feature nobody uses.
 */

const PORTAL_LABEL: Record<Portal, string> = {
  exporter: 'Exporter portal',
  agent: 'Agent console',
  ops: 'Operations',
};

export function CommandPalette({ portal, navigation }: { portal: Portal; navigation: NavItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return navigation;
    // Subsequence match, so "ovw" finds "Overview" and "agdl" finds nothing silly.
    return navigation.filter((item) => {
      const label = item.label.toLowerCase();
      if (label.includes(q)) return true;
      let at = 0;
      for (const ch of q) {
        at = label.indexOf(ch, at) + 1;
        if (at === 0) return false;
      }
      return true;
    });
  }, [navigation, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  // ⌘K / Ctrl+K anywhere. Bound on the document so it works regardless of focus, but it
  // stands down inside a text field so it cannot hijack someone mid-sentence.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
        return;
      }
      if (event.key === '/' && !typing && !open) {
        event.preventDefault();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
      return;
    }
    // Remember what opened the palette so focus can be handed back on close. Losing focus
    // to <body> strands a keyboard user at the top of the document.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
  }, [open]);

  /**
   * Modal keyboard contract, at the document level.
   *
   * Escape was previously wired to `onKeyDown` on the INPUT alone, so it stopped working
   * the moment focus moved into the results list — the dialog became uncloseable by
   * keyboard. And nothing trapped Tab, so focus walked out of a dialog still marked
   * `aria-modal="true"`, into content that attribute promises is not there.
   *
   * Both are handled here rather than on the container, because focus can legitimately
   * sit on any descendant and a container handler only sees what bubbles to it.
   */
  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;

      const root = dialogRef.current;
      if (!root) return;
      // `tabIndex >= 0` is the real test, not the selector. The backdrop is a
      // `<button tabIndex={-1}>` — a selector matching `button` alone counts it as the
      // first focusable, so Shift+Tab from the input saw itself as "not first", was not
      // intercepted, and walked straight out of the dialog past an element the browser
      // then skipped.
      const focusable = [...root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]',
      )].filter((el) => el.tabIndex >= 0 && (el.offsetWidth > 0 || el.offsetHeight > 0));
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement as HTMLElement | null;

      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);

  // Hand focus back to whatever opened it, once the dialog is actually gone.
  //
  // Falls back to the trigger when the remembered element cannot take focus — the palette
  // opens on ⌘K from anywhere, so the "opener" is often <body> or an element that has
  // since unmounted, and calling focus() on those silently leaves the user at the top of
  // the document with no idea where they are.
  useEffect(() => {
    if (open) return;
    const remembered = restoreFocusRef.current;
    restoreFocusRef.current = null;
    const target =
      remembered && document.contains(remembered) && remembered !== document.body
        ? remembered
        : triggerRef.current;
    target?.focus();
  }, [open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onInputKey(event: React.KeyboardEvent) {
    // Escape is handled by the document-level modal contract above, so it is deliberately
    // absent here — two handlers for one key is how they drift apart.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = results[cursor];
      if (target) go(target.href);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="focus-visible-ring group flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-xs text-muted transition-colors duration-fast hover:border-line-strong hover:text-bone md:h-8 md:px-2.5"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
          <circle cx="7" cy="7" r="4.75" />
          <path d="m10.5 10.5 3 3" strokeLinecap="round" />
        </svg>
        <span className="sr-only sm:not-sr-only">Search</span>
        <kbd aria-hidden="true" className="hidden rounded-sm border border-line px-1 py-px font-mono text-[10px] text-muted group-hover:text-muted sm:inline">
          ⌘K
        </kbd>
      </button>

      {open ? (
        <div
          ref={dialogRef}
          className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <button
            type="button"
            aria-label="Close command palette"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default bg-[color-mix(in_srgb,var(--ground)_70%,transparent)] backdrop-blur-sm"
          />
          <div className="animate-pop-in relative w-full max-w-lg overflow-hidden rounded-xl border border-line-strong bg-surface-3 shadow-overlay">
            <div className="flex items-center gap-3 border-b border-line px-4">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true" className="shrink-0 text-muted">
                <circle cx="7" cy="7" r="4.75" />
                <path d="m10.5 10.5 3 3" strokeLinecap="round" />
              </svg>
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onInputKey}
                placeholder={`Go to… (${PORTAL_LABEL[portal]})`}
                aria-label="Search destinations"
                aria-controls="command-palette-results"
                className="h-12 w-full bg-transparent text-sm text-bone outline-none placeholder:text-muted"
              />
              <kbd className="shrink-0 rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted">esc</kbd>
            </div>

            <ul ref={listRef} id="command-palette-results" className="max-h-80 overflow-y-auto p-1.5">
              {results.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-muted">Nothing matches “{query}”.</li>
              ) : (
                results.map((item, index) => (
                  <li key={item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(item.href)}
                      className={clsx(
                        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors duration-fast',
                        index === cursor ? 'bg-accent-tint text-bone' : 'text-slate',
                      )}
                    >
                      <span>{item.label}</span>
                      <span className="record text-[11px] text-muted">{item.href}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}
