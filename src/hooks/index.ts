'use client';

import { useEffect, useState } from 'react';

/** docs/03 §5: search/filter inputs debounce 250-400ms before triggering a fetch. */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
