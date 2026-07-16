'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import PricingModal from './PricingModal'
import type { EventMealDTO, MealPricingRuleDTO, PricingRuleDTO } from '@/modules/events'

type Props = {
  className?: string
  meals: EventMealDTO[]
  pricingRules: PricingRuleDTO[]
  mealPricingRules: MealPricingRuleDTO[]
}

export default function PricingInfoButton({
  className,
  meals,
  pricingRules,
  mealPricingRules,
}: Props) {
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
      <PricingModal
        isOpen={open}
        onClose={() => setOpen(false)}
        meals={meals}
        pricingRules={pricingRules}
        mealPricingRules={mealPricingRules}
      />
    </>
  )
}
