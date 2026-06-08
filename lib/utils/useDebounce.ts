'use client'

import { useEffect, useState } from 'react'

// Returns a debounced copy of `value` that only updates after `delayMs` of quiet.
// Used to throttle the /calculate-price call while the user edits the form.
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
