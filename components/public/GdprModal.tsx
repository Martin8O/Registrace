'use client'

import { useTranslations } from 'next-intl'

type Props = {
  isOpen: boolean
  onClose: () => void
}

type Section = {
  title: string
  body: string
}

// Consent / personal-data-protection info, shown as an overlay (mirrors
// PricingModal). Content is adapted for event registration from the BDC
// publishing house's GDPR policy; all text comes through next-intl (rule 5).
export default function GdprModal({ isOpen, onClose }: Props) {
  const t = useTranslations('form.gdprModal')

  if (!isOpen) return null

  const sections: Section[] = [
    { title: t('controller_title'), body: t('controller_body') },
    { title: t('data_title'), body: t('data_body') },
    { title: t('purpose_title'), body: t('purpose_body') },
    { title: t('retention_title'), body: t('retention_body') },
    { title: t('sharing_title'), body: t('sharing_body') },
    { title: t('rights_title'), body: t('rights_body') },
  ]

  return (
    <div
      className="fixed inset-0 z-50 bg-neutral-900/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 md:p-7"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-serif text-2xl font-semibold text-neutral-900">{t('title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-700 text-2xl font-bold leading-none transition"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className="h-0.5 w-10 bg-primary-500 mt-2 mb-5 rounded" />

        <p className="text-sm text-neutral-600 leading-relaxed">{t('intro')}</p>

        <div className="mt-5 space-y-4">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-sm font-semibold text-neutral-900">{section.title}</h3>
              <p className="mt-1 text-sm text-neutral-600 leading-relaxed">{section.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 text-right">
          <button type="button" onClick={onClose} className="btn-secondary">
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
