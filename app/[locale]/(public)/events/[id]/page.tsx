import { Fragment, type ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import RegistrationForm from '@/components/public/RegistrationForm'
import { getCentersForSelect, getPublicEventForDetail } from '@/modules/events'
import { formatDateRangeShort } from '@/lib/utils/formatDate'

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('event')

  // PUBLIC read: only publicly-visible events resolve here (P1 audit H1).
  // DRAFT / past events 404 instead of leaking detail + contact PII.
  const event = await getPublicEventForDetail(id)
  if (!event) notFound()

  // The form's centre dropdown is the registrant's home centre — the full
  // active-centre list, not the event's hosting centre (invariant: distinct).
  const centers = await getCentersForSelect()

  const title = locale === 'cs' ? event.title_cs : event.title_en
  const description = locale === 'cs' ? event.description_cs : event.description_en
  const centerName = locale === 'cs' ? event.center.name_cs : event.center.name_en
  const dateRange = formatDateRangeShort(event.startDate, event.endDate)

  // Contact details are language-neutral (one name, one number, one address for
  // both locales), so they are built here rather than picked per locale like the
  // texts above. Phone and e-mail are linked: on a phone the number is the point.
  const contactLink = 'text-primary-600 underline underline-offset-2 hover:text-primary-700'
  const contactParts: ReactNode[] = []
  if (event.contactName) contactParts.push(<span>{event.contactName}</span>)
  if (event.contactPhone)
    contactParts.push(
      // tel: takes no spaces — the admin types "+420 721 830 991", which a dialler
      // must receive as digits.
      <a href={`tel:${event.contactPhone.replace(/\s+/g, '')}`} className={contactLink}>
        {event.contactPhone}
      </a>,
    )
  if (event.contactEmail)
    contactParts.push(
      <a href={`mailto:${event.contactEmail}`} className={contactLink}>
        {event.contactEmail}
      </a>,
    )

  return (
    <div className="max-w-public mx-auto px-5 md:px-8 pt-4 md:pt-6 pb-10 md:pb-14">
      <h1 className="font-serif text-2xl md:text-3xl font-semibold text-neutral-900 leading-snug">
        {centerName} — {title}
        <span className="ml-2.5">{dateRange}</span>
      </h1>
      <div className="h-0.5 w-12 bg-primary-500 mt-3 rounded" />

      {/* The admin types the description into a textarea, so it can hold line
          breaks and blank lines. HTML collapses those by default, which turned a
          three-paragraph description into one run-on line — `whitespace-pre-line`
          keeps the breaks the admin typed while still wrapping long lines. It is
          NOT `pre-wrap`: leading indentation stays collapsed, so a pasted text
          does not inherit stray alignment. Still plain text — no markup is
          interpreted, so nothing here can inject HTML. */}
      {description !== null && (
        <p className="mt-4 whitespace-pre-line text-neutral-600 leading-relaxed">{description}</p>
      )}

      {/* The organiser's own name, phone and e-mail — the same trio the
          confirmation mail signs off with ("Kontakt na pořadatele"). Until now
          that mail was the ONLY place they were readable, which is the wrong way
          round: the questions worth a phone call come BEFORE registering, not
          after. It sits under the description as a sign-off, and stands on its
          own when there is no description — the EN half is often left empty.
          Only the parts an event actually carries are rendered (all three are
          nullable, and an event may have any subset); with none of them the
          block disappears rather than leaving a bare heading. Public by design:
          getPublicEventForDetail 404s DRAFT and past events precisely so this
          contact PII is exposed only while the event is open to registrations. */}
      {contactParts.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
            {t('contact')}
          </p>
          {/* One dotted line on a wide screen, one part per line on a phone.
              Wrapping the single line instead left a dangling "·" at the end of
              the first line, and a stacked list is the better target anyway —
              the phone number is a tap. `items-start` keeps the stacked links
              as wide as their text, so the empty space beside them is not
              clickable. */}
          <p className="mt-1.5 flex flex-col items-start gap-y-0.5 text-neutral-600 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-1">
            {contactParts.map((part, i) => (
              <Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden="true" className="hidden text-neutral-300 sm:inline">
                    ·
                  </span>
                )}
                {part}
              </Fragment>
            ))}
          </p>
        </div>
      )}

      <div className="mt-4 flex items-center justify-end">
        <PricingInfoButton
          meals={event.meals}
          pricingRules={event.pricingRules}
          mealPricingRules={event.mealPricingRules}
          participationPricingTypes={event.participationPricingTypes}
          mealPricingTypes={event.mealPricingTypes}
        />
      </div>

      <RegistrationForm
        eventId={event.id}
        dates={event.dates}
        meals={event.meals}
        centers={centers}
        pricingRules={event.pricingRules}
        mealPricingRules={event.mealPricingRules}
        participationPricingTypes={event.participationPricingTypes}
        mealPricingTypes={event.mealPricingTypes}
        mealRegistrationDeadline={event.mealRegistrationDeadline}
      />
    </div>
  )
}
