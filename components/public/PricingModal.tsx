'use client'

import { useTranslations } from 'next-intl'

type Props = {
  isOpen: boolean
  onClose: () => void
}

type PricingRow = {
  label: string
  value: string
}

export default function PricingModal({ isOpen, onClose }: Props) {
  const t = useTranslations('event.pricingModal')

  if (!isOpen) return null

  const rows: PricingRow[] = [
    { label: t('breakfast'), value: '80 CZK' },
    { label: t('lunch'), value: '120 CZK' },
    { label: t('dinner'), value: '120 CZK' },
    { label: t('dailyRate.age03'), value: '0 CZK' },
    { label: t('dailyRate.age47'), value: '0 CZK' },
    { label: t('dailyRate.age814'), value: '0 CZK' },
    { label: t('dailyRate.age15standard'), value: '100 CZK' },
    { label: t('dailyRate.age15supported'), value: '30 CZK' },
    { label: t('dailyRate.age15surplus'), value: '200 CZK' },
    { label: t('eveningArrivalDiscount'), value: '100 CZK' },
    { label: t('earlyDepartureDiscount'), value: '100 CZK' },
    { label: t('pricePerNight'), value: '0 CZK' },
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
        <div className="flex items-start justify-between">
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
        <div className="h-0.5 w-10 bg-primary-500 mt-2 mb-6 rounded" />

        <div className="rounded-lg border border-neutral-200 overflow-hidden">
          {rows.map((row, i) => (
            <div
              key={row.label}
              className={`flex items-center justify-between px-4 py-2.5 ${
                i % 2 === 0 ? 'bg-white' : 'bg-stone-50'
              }`}
            >
              <span className="text-sm text-neutral-700">{row.label}</span>
              <span className="font-mono text-[15px] text-primary-600 tabular-nums">
                {row.value}
              </span>
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
