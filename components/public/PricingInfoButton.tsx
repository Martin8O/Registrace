'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import PricingModal from './PricingModal'

type Props = {
  className?: string
}

export default function PricingInfoButton({ className }: Props) {
  const [open, setOpen] = useState(false)
  const t = useTranslations('event')

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`btn-secondary ${className ?? ''}`.trim()}
      >
        {t('pricingInfo')}
      </button>
      <PricingModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
