'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import PricingModal from './PricingModal'

export default function PricingInfoButton() {
  const [open, setOpen] = useState(false)
  const t = useTranslations('event')

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-blue-600 hover:text-blue-800 underline"
      >
        {t('pricingInfo')}
      </button>
      <PricingModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
