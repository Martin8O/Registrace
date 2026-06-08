'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import LanguageSwitcher from '@/components/shared/LanguageSwitcher'
import LogoutButton from './LogoutButton'

type NavItem = { key: string; href: string; exact?: boolean }

// Authenticated admin shell navigation. Desktop = fixed left column; mobile =
// top bar with a hamburger that toggles a stacked drawer (keeps everything
// inside the viewport — no horizontal scroll at 375px).
export default function AdminSidebar() {
  const pathname = usePathname()
  const locale = useLocale()
  const t = useTranslations('admin')
  const [open, setOpen] = useState(false)

  const base = `/${locale}/admin`
  const items: NavItem[] = [
    { key: 'dashboard', href: base, exact: true },
    { key: 'events', href: `${base}/events` },
    { key: 'registrations', href: `${base}/registrations` },
    { key: 'centers', href: `${base}/centers` },
    // TODO(B7): show "users" only to SUPER_ADMIN once role lookup exists.
    { key: 'users', href: `${base}/users` },
  ]

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  const navLinks = (onNavigate?: () => void) => (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key}>
          <Link
            href={item.href}
            onClick={onNavigate}
            className={`block rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive(item)
                ? 'bg-primary-50 text-primary-700'
                : 'text-neutral-700 hover:bg-neutral-50'
            }`}
          >
            {t(`nav.${item.key}`)}
          </Link>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      {/* Mobile top bar + drawer */}
      <div className="md:hidden">
        <div className="sticky top-0 z-40 flex h-[60px] items-center justify-between border-b-2 border-primary-500/90 bg-white px-4">
          <span className="font-serif text-lg font-semibold text-neutral-900">
            {t('brand')}
          </span>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="btn-secondary"
            aria-expanded={open}
          >
            {t('common.menu')}
          </button>
        </div>
        {open && (
          <div className="border-b border-neutral-200 bg-white px-4 py-4">
            {navLinks(() => setOpen(false))}
            <div className="mt-4 flex items-center justify-between gap-3">
              <LanguageSwitcher />
              <LogoutButton className="btn-secondary" />
            </div>
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:sticky md:top-0 border-r border-neutral-200 bg-white">
        <div className="flex h-[72px] items-center border-b-2 border-primary-500/90 px-5">
          <span className="font-serif text-xl font-semibold text-neutral-900">
            {t('brand')}
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">{navLinks()}</nav>
        <div className="space-y-3 border-t border-neutral-200 px-3 py-4">
          <LanguageSwitcher />
          <LogoutButton className="btn-secondary w-full" />
        </div>
      </aside>
    </>
  )
}
