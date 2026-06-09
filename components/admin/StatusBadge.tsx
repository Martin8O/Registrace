'use client'

import { useTranslations } from 'next-intl'
import type { MockEvent } from '@/lib/mock/events'
import type { MockRegistrationStatus } from '@/lib/mock/registrations'

// Event status chip — uses the admin `eventStatus` labels (Draft / Published /
// Closed / Archived) so the badge matches the status filter + the event form.
// (The public site keeps its own friendlier "open" badge — that's separate.)
const eventVariants: Record<MockEvent['status'], string> = {
  PUBLISHED: 'bg-gold-100 text-gold-800 border border-gold-300',
  DRAFT: 'bg-muted-bg text-muted-fg border border-muted-border',
  CLOSED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
  ARCHIVED: 'bg-neutral-200 text-neutral-600 border border-neutral-300',
}

export function EventStatusBadge({ status }: { status: MockEvent['status'] }) {
  const t = useTranslations('admin.eventStatus')
  return <span className={`badge ${eventVariants[status]}`}>{t(status)}</span>
}

// Registration status chip — its own variants + the admin.regStatus labels.
const regVariants: Record<MockRegistrationStatus, string> = {
  REGISTERED: 'bg-success-100 text-success-700 border border-success-500/40',
  CANCELLED: 'bg-danger-100 text-danger-700 border border-danger-500/40',
}

export function RegStatusBadge({ status }: { status: MockRegistrationStatus }) {
  const t = useTranslations('admin.regStatus')
  return <span className={`badge ${regVariants[status]}`}>{t(status)}</span>
}
