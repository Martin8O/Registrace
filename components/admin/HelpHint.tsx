'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

// The ten "?" hints of the admin help, keyed by topic. Their texts live in
// `help.hints` (Czech only, see i18n/request.ts).
export const HELP_HINTS = [
  'description',
  'contact',
  'tiers',
  'rates',
  'discounts',
  'mealExclude',
  'maxRegistrations',
  'status',
  'resend',
  'export',
] as const
export type HelpHintTopic = (typeof HELP_HINTS)[number]

// Rich-text tags the hint texts may use.
const tags = {
  b: (chunks: React.ReactNode) => <strong className="font-semibold text-neutral-900">{chunks}</strong>,
  i: (chunks: React.ReactNode) => <em>{chunks}</em>,
}

// A "?" button that opens a short explanation of a concept, next to a field's
// label — never inside it, so the field's accessible name stays what it was.
// Opens on click, closes on Escape, on a click outside, when focus leaves it, or
// on a second click. The bubble is nudged sideways to stay inside the screen (a
// "?" near either edge of a phone would otherwise push it off).
// The texts are Czech whatever the page language, hence lang="cs" on the bubble.
// "Víc: …" links to the matching section of the help page in a NEW tab: most
// hints sit inside the event wizard, whose unsaved input a same-tab navigation
// would throw away.
export default function HelpHint({
  topic,
  align = 'start',
}: {
  topic: HelpHintTopic
  // Which edge of the "?" the bubble lines up with; 'end' for a "?" near the
  // right side of the screen, so the bubble opens leftwards and stays on screen.
  align?: 'start' | 'end'
}) {
  const t = useTranslations('help.hints')
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)
  const popId = useId()

  // Keep the bubble at least 16px from both screen edges. Measured from the
  // anchor and the bubble's width, not from the bubble's own (already shifted)
  // position, so it settles in one pass.
  useLayoutEffect(() => {
    if (!open || !popRef.current || !wrapRef.current) return
    const anchor = wrapRef.current.getBoundingClientRect()
    const width = popRef.current.offsetWidth
    const gutter = 16
    const left = align === 'end' ? anchor.right - width : anchor.left
    let next = 0
    if (left + width > window.innerWidth - gutter) next = window.innerWidth - gutter - (left + width)
    if (left + next < gutter) next = gutter - left
    setShift(next)
  }, [open, align])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const paragraphs = (t.raw(`${topic}.body`) as string[]).map((_, i) => i)
  const more = t.has(`${topic}.more.anchor`)
    ? { anchor: t(`${topic}.more.anchor`), label: t(`${topic}.more.label`) }
    : null

  return (
    <span
      ref={wrapRef}
      className="relative inline-flex align-middle"
      onBlur={(e) => {
        if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-label={t('label', { topic: t(`${topic}.topic`) })}
        className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold leading-none transition ${
          open
            ? 'border-primary-500 bg-primary-500 text-white'
            : 'border-neutral-300 bg-white text-neutral-500 hover:border-primary-500 hover:bg-primary-50 hover:text-primary-600'
        }`}
      >
        ?
      </button>
      {open && (
        <span
          ref={popRef}
          id={popId}
          lang="cs"
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          role="note"
          className={`absolute top-full z-40 mt-2 block w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-neutral-200 bg-white px-4 py-3.5 text-left text-sm font-normal normal-case leading-relaxed tracking-normal text-neutral-700 shadow-lg ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {paragraphs.map((i) => (
            <span key={i} className={`block ${i > 0 ? 'mt-2' : ''}`}>
              {t.rich(`${topic}.body.${i}`, tags)}
            </span>
          ))}
          {more && (
            <a
              href={`/${locale}/admin/help#${more.anchor}`}
              target="_blank"
              rel="noopener"
              className="mt-2.5 inline-block border-b border-primary-100 text-sm font-medium text-primary-600 hover:border-primary-500"
            >
              {more.label}
              <span className="sr-only"> ({t('newTab')})</span>
            </a>
          )}
        </span>
      )}
    </span>
  )
}
