'use client';

/**
 * Today's rupee rate for the Demand Discovery views (D-023). A server page reads the rate
 * (`todayInrPerUsd`) and wraps its client tree in `RupeeRateProvider`; components add the rupee
 * figure beside each dollar figure with `useRupees()`. Without a rate, dollars are shown alone.
 */

import { createContext, useCallback, useContext, type ReactNode } from 'react';
import type { DisplayRate } from '@/lib/fx/display-rate';
import { withRupees } from '@/lib/money-format';

const RupeeRateContext = createContext<DisplayRate | null>(null);

export function RupeeRateProvider({ rate, children }: { rate: DisplayRate | null; children: ReactNode }) {
  return <RupeeRateContext.Provider value={rate}>{children}</RupeeRateContext.Provider>;
}

export function useRupeeRate(): DisplayRate | null {
  return useContext(RupeeRateContext);
}

/** A function that appends rupee figures to a sentence's dollar amounts at today's rate. */
export function useRupees(): (text: string) => string {
  const rate = useRupeeRate();
  return useCallback((text: string) => withRupees(text, rate?.inr_per_usd), [rate]);
}

const DAY = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** One line naming the rate and its day, so a rupee figure is never shown without its basis. */
export function RupeeRateNote() {
  const rate = useRupeeRate();
  if (!rate) return null;
  return (
    <p className="text-xs text-[var(--color-text-muted)]">
      Rupee amounts use the ECB rate of ₹{rate.inr_per_usd.toFixed(2)} per US$1 ({DAY.format(new Date(`${rate.observation_date}T00:00:00Z`))}). They follow the daily rate, so they change from day to day.
    </p>
  );
}
