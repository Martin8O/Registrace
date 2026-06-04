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
    <div className="flex gap-2 text-sm">
      <button
        onClick={() => switchTo('cs')}
        className={locale === 'cs' ? 'font-bold underline' : 'text-gray-500 hover:text-gray-900'}
      >
        CZ
      </button>
      <span className="text-gray-300">|</span>
      <button
        onClick={() => switchTo('en')}
        className={locale === 'en' ? 'font-bold underline' : 'text-gray-500 hover:text-gray-900'}
      >
        EN
      </button>
    </div>
  )
}
