// Open Graph speaks its own locale codes, not our URL prefixes — `cs_CZ`, not
// `cs`. Declared once so the site card and the per-event card cannot drift.
const OG_LOCALE = { cs: "cs_CZ", en: "en_GB" } as const;

/** The og:locale for this page, plus the one the other half of the site is in. */
export function ogLocales(locale: string): { locale: string; alternateLocale: string } {
  return locale === "en"
    ? { locale: OG_LOCALE.en, alternateLocale: OG_LOCALE.cs }
    : { locale: OG_LOCALE.cs, alternateLocale: OG_LOCALE.en };
}
