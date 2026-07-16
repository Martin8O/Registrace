'use client'

import { useTranslations } from 'next-intl'

// Live "passwords match / do not match" line under the confirm field.
//
// Renders NOTHING until the confirm field has something in it. Telling someone
// their passwords do not match before they have started typing the second one is
// technically true and useless — the same reason the requirements checklist
// starts grey rather than red.
//
// a11y: aria-live so the flip to "match" is announced, and the state is in the
// text, not only in the colour.

export function PasswordMatch({ value, confirm }: { value: string; confirm: string }) {
  const t = useTranslations('admin.passwordPolicy')
  if (confirm.length === 0) return null

  const matches = value === confirm
  return (
    <p
      aria-live="polite"
      className={`mt-1.5 flex items-center gap-1.5 text-xs ${
        matches ? 'text-success-700' : 'text-danger-600'
      }`}
    >
      <span aria-hidden="true">{matches ? '✓' : '✗'}</span>
      {matches ? t('match') : t('noMatch')}
    </p>
  )
}
