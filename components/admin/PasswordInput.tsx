'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

// Password field with a show/hide toggle. Used for both the new-password and the
// confirm field on set-password and profile, so the two screens cannot drift.
//
// The toggle MUST be type="button": inside a <form>, a button defaults to
// type="submit", so revealing the password would submit the form.
//
// a11y: the icon is decorative (aria-hidden) and the state lives on the button —
// aria-pressed for the toggle, plus an aria-label that swaps between show/hide so
// a screen reader announces the action, not an eye.

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M12 5c-5 0-9.27 3.11-11 7 1.73 3.89 6 7 11 7s9.27-3.11 11-7c-1.73-3.89-6-7-11-7Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.75" stroke="currentColor" strokeWidth="1.6" />
      {off && (
        <path d="M4 4 20 20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      )}
    </svg>
  )
}

export function PasswordInput({
  id,
  value,
  onChange,
  describedBy,
  required,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  describedBy?: string
  required?: boolean
}) {
  const [visible, setVisible] = useState(false)
  const t = useTranslations('admin.passwordPolicy')

  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        className="bdc-input pr-11"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={describedBy}
        required={required}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('hide') : t('show')}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-neutral-500 hover:text-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
      >
        <EyeIcon off={visible} />
      </button>
    </div>
  )
}
