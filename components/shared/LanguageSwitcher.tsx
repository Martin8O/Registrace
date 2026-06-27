'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'

export default function LanguageSwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const locale = useLocale()

  function switchTo(targetLocale: string) {
    const segments = pathname.split('/')
    segments[1] = targetLocale
    // Preserve the current query string so switching language stays on the SAME
    // page state: the event-scoped registrations view (?event=…) and the event
    // form's step (?step=…) both live in the query, which usePathname() drops.
    // Read it live from window.location so any in-page history.replaceState
    // (e.g. the stepper syncing its step) is reflected at click time.
    const search = typeof window !== 'undefined' ? window.location.search : ''
    router.push(segments.join('/') + search)
  }

  return (
    <span className="inline-flex items-center rounded-full border border-neutral-300 text-xs font-medium overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => switchTo('cs')}
        className={`px-2.5 py-1 transition ${locale === 'cs' ? 'bg-primary-500 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
      >
        CZ
      </button>
      <button
        type="button"
        onClick={() => switchTo('en')}
        className={`px-2.5 py-1 transition ${locale === 'en' ? 'bg-primary-500 text-white' : 'text-neutral-600 hover:bg-neutral-50'}`}
      >
        EN
      </button>
    </span>
  )
}
