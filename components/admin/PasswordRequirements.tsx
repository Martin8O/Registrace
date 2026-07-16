'use client'

import { useTranslations } from 'next-intl'
import { checkPassword, MIN_LENGTH, type PasswordRuleId } from '@/lib/validation/password'

// Live checklist under a new-password field: every rule is listed up front, and
// each one ticks as it is satisfied. Requirements are shown BEFORE the admin
// types (greyed, not red) — a checklist that only appears on failure is a puzzle,
// not guidance.
//
// This is guidance only; the enforcement lives in Supabase (see
// lib/validation/password). Rendering it does not make the policy real.
//
// a11y: the list is a live region so a screen reader announces a rule flipping to
// met, and each item carries its state in text rather than colour alone.

const labelKey: Record<PasswordRuleId, string> = {
  length: 'ruleLength',
  lowercase: 'ruleLowercase',
  uppercase: 'ruleUppercase',
  digit: 'ruleDigit',
  symbol: 'ruleSymbol',
}

export function PasswordRequirements({ value }: { value: string }) {
  const t = useTranslations('admin.passwordPolicy')
  const rules = checkPassword(value)

  return (
    <div className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5">
      <p className="text-xs font-medium text-neutral-600">{t('title')}</p>
      <ul className="mt-1.5 space-y-1" aria-live="polite">
        {rules.map(({ id, met }) => (
          <li
            key={id}
            className={`flex items-start gap-1.5 text-xs ${
              met ? 'text-success-700' : 'text-neutral-500'
            }`}
          >
            <span aria-hidden="true" className="mt-px leading-none">
              {met ? '✓' : '○'}
            </span>
            <span>
              {t(labelKey[id], { count: MIN_LENGTH })}
              <span className="sr-only"> — {met ? t('met') : t('notMet')}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
