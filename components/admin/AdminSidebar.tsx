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
    // TODO(B7): show "centers" + "users" only to SUPER_ADMIN once role lookup exists.
    { key: 'centers', href: `${base}/centers` },
    { key: 'users', href: `${base}/users` },
  ]
  const profileItem: NavItem = { key: 'profile', href: `${base}/profile` }

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }

  function linkClass(item: NavItem): string {
    return `block rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive(item)
        ? 'bg-primary-50 text-primary-700'
        : 'text-neutral-700 hover:bg-neutral-50'
    }`
  }

  const navLinks = (onNavigate?: () => void) => (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item.key}>
          <Link href={item.href} onClick={onNavigate} className={linkClass(item)}>
            {t(`nav.${item.key}`)}
          </Link>
        </li>
      ))}
    </ul>
  )

  // Profile link with a person silhouette — sits in the bottom-left corner,
  // just above the rule that holds the language switcher + logout.
  const profileLink = (onNavigate?: () => void) => (
    <Link
      href={profileItem.href}
      onClick={onNavigate}
      className={`flex items-center gap-2 ${linkClass(profileItem)}`}
    >
      <PersonIcon />
      {t('nav.profile')}
    </Link>
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
            <div className="mt-1">{profileLink(() => setOpen(false))}</div>
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-neutral-200 pt-4">
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
        <div className="px-3 pb-2">{profileLink()}</div>
        <div className="space-y-3 border-t border-neutral-200 px-3 py-4">
          <LanguageSwitcher />
          <LogoutButton className="btn-secondary w-full" />
        </div>
      </aside>
    </>
  )
}

// Upper-body person silhouette (inline SVG — no icon library).
function PersonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.69-8 6v1a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1c0-3.31-3.58-6-8-6Z" />
    </svg>
  )
}
