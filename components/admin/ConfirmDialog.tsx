'use client'

import { useTranslations } from 'next-intl'

// Small reusable confirm modal (BDC styling, mirrors the event publish modal).
// Used for destructive admin actions (delete centre, remove admin) so they ask
// "really?" before firing. Renders nothing when closed.
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  busy?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('admin')
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-serif text-xl font-semibold text-neutral-900">{title}</h2>
        <div className="mt-2 mb-4 h-0.5 w-10 rounded bg-primary-500" />
        <p className="text-sm text-neutral-600">{body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${
              danger
                ? 'rounded-lg bg-danger-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-danger-700'
                : 'btn-primary'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
