import { Fragment, cache, type ReactNode } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import PricingInfoButton from '@/components/public/PricingInfoButton'
import RegistrationForm from '@/components/public/RegistrationForm'
import { getCentersForSelect, getPublicEventForDetail } from '@/modules/events'
import { formatDateRangeShort, formatDeadlineDateTime } from '@/lib/utils/formatDate'
import { ogLocales } from '@/lib/metadata/openGraph'

// generateMetadata and the page both need the event. React's cache dedupes them
// into ONE query per request — without it every event page would hit the database
// twice for the same row.
const loadEvent = cache((id: string) => getPublicEventForDetail(id))

// Validation requires both halves of a title and of a centre name to be
// non-empty, so this fallback should never fire — but a blank card title is a
// silent, permanent embarrassment on somebody else's screen, and the same
// columns hold rows that predate the current validation. Falling back to the
// other language beats previewing an event with no name.
function pickLocale(locale: string, cs: string, en: string): string {
  const preferred = locale === 'en' ? en : cs
  const fallback = locale === 'en' ? cs : en
  return preferred.trim() ? preferred : fallback
}

// The line a shared link previews with: centre, event, dates — the same three
// things the page's <h1> says, in the same order.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}): Promise<Metadata> {
  const { locale, id } = await params

  // Read through the PUBLIC service, exactly as the page does. A DRAFT or
  // finished event resolves to null here and the card falls back to the neutral
  // site-level one — naming an unpublished event in a link preview leaks it just
  // as surely as rendering the page would, and a preview is copied and re-shared
  // far more widely than a page is opened (P1 audit H1).
  const event = await loadEvent(id)
  if (!event) return {}

  const [tEvent, tMeta] = await Promise.all([
    getTranslations({ locale, namespace: 'event' }),
    getTranslations({ locale, namespace: 'meta' }),
  ])

  const title = pickLocale(locale, event.title_cs, event.title_en)
  const centerName = pickLocale(locale, event.center.name_cs, event.center.name_en)
  const heading = `${centerName} — ${title} · ${formatDateRangeShort(event.startDate, event.endDate)}`

  // The ONLY event text that reaches a meta tag is the meal cut-off. The
  // description_* columns are operational instructions — the live event's opens
  // with a price table, whose first 160 characters are worse than no description
  // at all — and subtitle_* is a field the admin wizard cannot fill, so a card
  // line built on it would appear for seeded events and never for real ones.
  // Everything a registrant needs is on the page, one click away.
  const description = event.mealRegistrationDeadline
    ? `${tEvent('mealDeadline')} ${formatDeadlineDateTime(event.mealRegistrationDeadline)}`
    : tMeta('description')

  const siteName = tMeta('siteName')
  const path = `/${locale}/events/${id}`

  return {
    title: heading,
    description,
    alternates: {
      canonical: path,
      languages: { cs: `/cs/events/${id}`, en: `/en/events/${id}` },
    },
    openGraph: {
      type: 'website',
      siteName,
      // `absolute` keeps the site name out of the card's one strong line — the
      // layout's title template would otherwise append it, and og:site_name
      // already carries it as its own field.
      title: { absolute: heading },
      description,
      ...ogLocales(locale),
      url: path,
    },
    twitter: { card: 'summary_large_image', title: { absolute: heading }, description },
  }
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>
}) {
  const { locale, id } = await params
  const t = await getTranslations('event')

  // PUBLIC read: only publicly-visible events resolve here (P1 audit H1).
  // DRAFT / past events 404 instead of leaking detail + contact PII.
  // Same memoized read generateMetadata used — one query, not two.
  const event = await loadEvent(id)
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

      {/* The meal-ordering cut-off. It is stored, it closes the meal pills in the
          form, and until now it was shown NOWHERE on the public page — a
          registrant found out it had passed only by the meals no longer being
          offered. Same treatment as the contact block above (M45): small
          uppercase label, value on the line below, `mt-6` from whatever
          precedes it. The two blocks are independent — an event may have a
          contact and no deadline, a deadline and no contact, both or neither —
          so this hangs off nothing and the spacing holds in all four cases.
          The string is the SAME one the link preview's description carries,
          from the same formatter. */}
      {event.mealRegistrationDeadline !== null && (
        <div className="mt-6">
          <p className="text-xs font-bold uppercase tracking-widest text-neutral-400">
            {t('mealDeadline')}
          </p>
          <p className="mt-1.5 text-neutral-600">
            {formatDeadlineDateTime(event.mealRegistrationDeadline)}
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
