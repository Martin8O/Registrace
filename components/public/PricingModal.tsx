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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{t('title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-xl font-bold leading-none"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b last:border-0">
                <td className="py-2 text-gray-700">{row.label}</td>
                <td className="py-2 text-right font-medium text-gray-900">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 text-right">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-100 hover:bg-gray-200 rounded"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
