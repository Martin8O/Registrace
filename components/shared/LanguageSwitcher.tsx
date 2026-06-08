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
    router.push(segments.join('/'))
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
