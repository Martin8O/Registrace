// lib/email — registration-confirmation email via Resend (invariant 6:
// email-only, never throws, a failure must never block or roll back the DB
// write). P6: production bilingual template — a responsive (≤760px, table-based,
// fully inline CSS, no external resources) HTML mail rendered in ONE language
// chosen by `lang`. The text lives in a small inline cs/en map because email
// rendering happens outside the next-intl request scope. Both call sites (submit
// + admin resend) feed it via the DRY builder in modules/registrations.

import { Resend } from "resend";

// One ordered meal slot. `order` is the event day's sortOrder — the days are
// grouped and sorted by it, never by the label, which is human text.
export type ConfirmationMeal = {
  day: string; // localized event-day label, e.g. "Pátek 18. 9."
  order: number;
  mealType: string; // BREAKFAST | LUNCH | DINNER
};

export type ConfirmationParticipant = {
  fullName: string;
  ageCategory: string;
  // The two independent tiers this person was priced on (invariant 22), present at
  // EVERY age (invariant 15). They used to be one tier, blanked out under 15 — so a
  // parent of a supported child was mailed a dash where their tier should be.
  pricingType?: string;
  mealPricingType?: string;
  mealType: string; // MEAT | VEGETARIAN — diet for the ordered meals
  // The ordered slots, structured rather than pre-composed. They used to arrive
  // as ready-made strings ("Pátek 18.9. – večeře") and were printed as one
  // comma-separated run in a narrow cell, which on a two-person registration
  // already wrapped to four lines of near-identical text. The template groups
  // them by day instead, and it cannot do that from a sentence.
  meals: ConfirmationMeal[];
  subtotal: number; // whole CZK (invariant 10)
};

export type ConfirmationEmailData = {
  registrationNumber: string | null; // human-readable "26002108"; null only for legacy rows
  to: string;
  eventTitle: string;
  eventStart: Date;
  eventEnd: Date;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  arrivalLabel: string; // event-day label, already localized
  arrivalTime: string; // MORNING | AFTERNOON | EVENING
  departureLabel: string;
  earlyDeparture: string; // NONE | AFTER_BREAKFAST
  hasAccommodation: boolean;
  centerName: string; // registrant's home centre, already localized
  participants: ConfirmationParticipant[];
  totalPrice: number; // whole CZK
};

export type SendResult = { sent: boolean; error?: string };

type Lang = "cs" | "en";

// Exported for one reason: so a test can hold these strings against the locale
// files. The email is the LEAST observable surface in the app — the admin panel
// can be opened and looked at, but the wording of a confirmation is only ever
// seen by someone who receives one, which is exactly why it should not be the
// only user-facing text with nothing checking it. Nothing outside this module
// renders from this table; treat it as private in every other sense.
export const TEXT: Record<Lang, Record<string, string>> = {
  cs: {
    subject: "Potvrzení registrace — ",
    heading: "Potvrzení registrace",
    intro: "Děkujeme, vaše registrace byla přijata. Níže najdete její shrnutí.",
    event: "Akce",
    dates: "Termín",
    stay: "Váš pobyt",
    organizer: "Kontakt na pořadatele",
    arrival: "Příjezd",
    departure: "Odjezd",
    early_departure: "Dřívější odjezd",
    accommodation: "Ubytování",
    center: "Centrum",
    participants: "Účastníci",
    meals: "Strava",
    meals_by_day: "Strava po dnech",
    diet: "Typ stravy",
    meals_count: "Objednaná jídla",
    meals_none: "K této registraci není objednané žádné jídlo.",
    BREAKFAST: "Snídaně",
    LUNCH: "Oběd",
    DINNER: "Večeře",
    meals_total: "Celkem jídel",
    everyone: "všichni",
    name: "Jméno",
    age: "Věk",
    type: "Typ",
    price: "Cena",
    none_dash: "—",
    subtotal: "Mezisoučet",
    total: "Celková cena",
    currency: "Kč",
    registration_number: "Číslo registrace",
    gdpr: "Vaše osobní údaje zpracováváme v souladu se zásadami ochrany osobních údajů (kontakt: info@bdc.cz).",
    yes: "ano",
    no: "ne",
    MORNING: "dopoledne",
    AFTERNOON: "odpoledne",
    EVENING: "večer",
    NONE: "ne",
    AFTER_BREAKFAST: "po snídani",
    AGE_0_3: "0–3 roky",
    AGE_4_7: "4–7 let",
    AGE_8_14: "8–14 let",
    AGE_15_PLUS: "15 let a více",
    STANDARD: "standardní cena",
    SUPPORTED: "podporovaná cena",
    SURPLUS: "cena nadbytek",
    // Names BOTH halves the stay tier prices — a daily rate and a rate per
    // night, either of which can be 0 alone. Held against
    // `form.participation_price` in the locales by sendConfirmation.test.ts:
    // a registrant reconciling the mail against the site must be reading one
    // name for one amount, not two.
    tier_participation: "účast a noc",
    tier_meals: "strava",
    MEAT: "masitá",
    VEGETARIAN: "vegetariánská",
  },
  en: {
    subject: "Registration confirmation — ",
    heading: "Registration confirmation",
    intro: "Thank you, your registration has been received. A summary is below.",
    event: "Event",
    dates: "Dates",
    stay: "Your stay",
    organizer: "Organizer contact",
    arrival: "Arrival",
    departure: "Departure",
    early_departure: "Early departure",
    accommodation: "Accommodation",
    center: "Centre",
    participants: "Participants",
    meals: "Meals",
    meals_by_day: "Meals by day",
    diet: "Diet",
    meals_count: "Meals ordered",
    meals_none: "No meals are ordered for this registration.",
    BREAKFAST: "Breakfast",
    LUNCH: "Lunch",
    DINNER: "Dinner",
    meals_total: "Meals in total",
    everyone: "everyone",
    name: "Name",
    age: "Age",
    type: "Type",
    price: "Price",
    none_dash: "—",
    subtotal: "Subtotal",
    total: "Total price",
    currency: "CZK",
    registration_number: "Registration no.",
    gdpr: "We process your personal data in accordance with our privacy policy (contact: info@bdc.cz).",
    yes: "yes",
    no: "no",
    MORNING: "morning",
    AFTERNOON: "afternoon",
    EVENING: "evening",
    NONE: "no",
    AFTER_BREAKFAST: "after breakfast",
    AGE_0_3: "0–3 years",
    AGE_4_7: "4–7 years",
    AGE_8_14: "8–14 years",
    AGE_15_PLUS: "15 years and over",
    STANDARD: "standard price",
    SUPPORTED: "supported price",
    SURPLUS: "surplus price",
    tier_participation: "participation and night",
    tier_meals: "meals",
    MEAT: "meat",
    VEGETARIAN: "vegetarian",
  },
};

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Event days are stored as UTC midnight; everything is read in Europe/Prague so
// the calendar day is preserved (invariant 11).
const TZ = "Europe/Prague";

// Numeric day/month/year of a UTC date as seen in Prague — built by hand from
// parts so the output is independent of any locale's number formatting.
function ymd(date: Date): { day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { day: get("day"), month: get("month"), year: get("year") };
}

// The month name in the grammatically correct form for a *date* (Czech needs the
// genitive — "května", not the standalone nominative "květen" — which only
// appears when a day is present, hence day:"numeric" here too).
function monthName(date: Date, lang: Lang): string {
  const parts = new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-US", {
    timeZone: TZ,
    day: "numeric",
    month: "long",
  }).formatToParts(date);
  return parts.find((p) => p.type === "month")?.value ?? "";
}

// Compact, human range: "7.–10. května 2026" / "May 7–10, 2026". Collapses the
// shared month/year and handles single-day, cross-month, and cross-year stays.
function formatDateRange(start: Date, end: Date, lang: Lang): string {
  const s = ymd(start);
  const e = ymd(end);
  const sM = monthName(start, lang);
  const eM = monthName(end, lang);

  if (lang === "cs") {
    if (s.year === e.year && s.month === e.month && s.day === e.day) return `${s.day}. ${sM} ${s.year}`;
    if (s.year === e.year && s.month === e.month) return `${s.day}.–${e.day}. ${eM} ${e.year}`;
    if (s.year === e.year) return `${s.day}. ${sM} – ${e.day}. ${eM} ${e.year}`;
    return `${s.day}. ${sM} ${s.year} – ${e.day}. ${eM} ${e.year}`;
  }
  if (s.year === e.year && s.month === e.month && s.day === e.day) return `${sM} ${s.day}, ${s.year}`;
  if (s.year === e.year && s.month === e.month) return `${sM} ${s.day}–${e.day}, ${e.year}`;
  if (s.year === e.year) return `${sM} ${s.day} – ${eM} ${e.day}, ${e.year}`;
  return `${sM} ${s.day}, ${s.year} – ${eM} ${e.day}, ${e.year}`;
}

// ── Email design tokens — the BDC palette (visual-identity.md): deep crimson
// primary + warm gold accent on warm stone/neutral. Inline only; email clients
// (notably Gmail) strip <style>/<head> rules, so every visual property lives on
// the element. Layout is table-based with width:100% + max-width:760px — 600 was
// the original cap, when this mail was mostly label/value rows; it now carries a
// five-column participant table that cannot fit one without breaking a phrase. Web fonts can't load in email, so
// headings fall back to the documented Georgia serif and the number to a mono stack.
const C = {
  page: "#FAF8F4", // stone-100 (warm off-white body)
  card: "#ffffff",
  text: "#4A423A", // neutral-700 (body)
  heading: "#221E1A", // neutral-900
  muted: "#847A6C", // neutral-500
  faint: "#A89E90", // neutral-400
  crimson: "#A51A2E", // primary-500
  crimsonDark: "#8E1728", // primary-600
  crimsonBg: "#FBF1F2", // primary-50 (reg-number block)
  gold: "#C99A2E", // gold-500
  line: "#E2DBD2", // neutral-200
  zebra: "#FAF8F4", // stone-100 (subtle zebra on white)
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};

// Exported alongside TEXT so the template itself can be asserted and previewed
// without sending anything. The meal summary is built here, not by a caller,
// so its grouping is only observable through the rendered HTML — and an email
// is the one surface nobody can go back and look at after the fact.
export function buildHtml(data: ConfirmationEmailData, lang: Lang): string {
  const t = (key: string): string => TEXT[lang][key] ?? key;
  const money = (n: number) => `${n.toLocaleString(lang === "cs" ? "cs-CZ" : "en-US")} ${t("currency")}`;

  // A labelled detail row (event / stay sections).
  const infoRow = (label: string, value: string) =>
    `<tr>
      <td style="padding:6px 0;color:${C.muted};font-size:13px;width:40%;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;color:${C.text};font-size:14px;vertical-align:top;">${value}</td>
    </tr>`;

  // A section sub-heading — crimson rule + crimson label, echoing the web's
  // primary-500 rule under headings.
  const sectionTitle = (label: string) =>
    `<tr><td style="padding:24px 0 6px;border-bottom:2px solid ${C.crimson};">
      <span style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${C.crimson};">${label}</span>
    </td></tr>`;

  const organizerParts = [data.contactName, data.contactPhone, data.contactEmail]
    .filter((v): v is string => v !== null && v !== "")
    .map(esc)
    .join(" · ");

  // ── Participants table: Name · Age · Type · Meals · Price + total row ──
  const th = (label: string, align: "left" | "right" = "left") =>
    `<th align="${align}" style="padding:8px 10px;border-bottom:2px solid ${C.crimson};color:${C.muted};font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${label}</th>`;

  const participantRows = data.participants
    .map((p, i) => {
      const bg = i % 2 === 1 ? `background:${C.zebra};` : "";
      const cell = `padding:8px 10px;border-bottom:1px solid ${C.line};font-size:14px;color:${C.text};vertical-align:top;${bg}`;
      // Only the DIET. What each person ordered is in the by-day summary above —
      // in this cell it was a comma-separated run that wrapped to four lines on a
      // two-person registration and repeated itself for every person after that.
      const diet = t(p.mealType);
      // Both tiers, at every age. Deliberately NOT nowrap, unlike the short
      // labels beside them: these are the widest cell in the table, and forcing
      // them whole pushed the table to 687px, which a phone can then only show
      // by shrinking the entire email. On the wide card they fit on one line
      // anyway; on a narrow one they wrap, which is the right way to lose.
      // They are named separately only when they
      // DIFFER — the case the two-tier feature exists for (surplus room, supported
      // food), which one label cannot express. When they agree, that one label is
      // already true of both halves, and repeating it under two headings would be
      // the same noise the price overview collapses away.
      const stayTier = p.pricingType ? t(p.pricingType) : t("none_dash");
      const mealTier = p.mealPricingType ? t(p.mealPricingType) : stayTier;
      const type =
        p.mealPricingType && p.mealPricingType !== p.pricingType
          ? `${t("tier_participation")}: ${stayTier}<br />${t("tier_meals")}: ${mealTier}`
          : stayTier;
      return `<tr>
        <td style="${cell}">${esc(p.fullName)}</td>
        <td style="${cell}white-space:nowrap;">${t(p.ageCategory)}</td>
        <td style="${cell}">${type}</td>
        <td style="${cell}white-space:nowrap;">${diet}</td>
        <td align="right" style="${cell}white-space:nowrap;">${money(p.subtotal)}</td>
      </tr>`;
    })
    .join("");

  // Prominent, centered registration number near the top (replaces the old long
  // internal id). Skipped only for legacy rows with no number.
  const regNumberBlock = data.registrationNumber
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 22px;">
        <tr><td align="center" style="background:${C.crimsonBg};border:1px solid ${C.crimson};border-radius:10px;padding:16px 20px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${C.crimson};">${t("registration_number")}</div>
          <div style="margin-top:6px;font-family:${C.mono};font-size:30px;font-weight:700;letter-spacing:.08em;color:${C.heading};">${esc(data.registrationNumber)}</div>
        </td></tr>
      </table>`
    : "";

  // ── Meals by day ─────────────────────────────────────────────────────────
  // The old cell listed one person's slots as a comma-separated run, repeated
  // per person — on two people it was already four wrapped lines of nearly the
  // same text. Grouping by day alone does not fix that: on a ten-person booking
  // where everyone eats everything, it becomes fourteen lines of the same ten
  // names. So this collapses twice, and both collapses are what make it short:
  //
  //   • meals of one day sharing the SAME set of eaters go on ONE line
  //     ("Snídaně · Oběd · Večeře — všichni"), because listing them apart says
  //     the same thing three times;
  //   • a set that is every participant is named "všichni (N)" rather than
  //     spelled out — the exception is the information, not the rule.
  //
  // A single-participant registration names nobody at all: there is one person
  // the whole email is about, and repeating their name on every line is exactly
  // the noise this section exists to remove.
  const solo = data.participants.length === 1;
  const MEAL_ORDER = ["BREAKFAST", "LUNCH", "DINNER"];

  // day order → { label, meal → the participants who ordered it, by index }
  const days = new Map<number, { day: string; byMeal: Map<string, number[]> }>();
  let mealTotal = 0;
  data.participants.forEach((p, pi) => {
    for (const m of p.meals) {
      mealTotal += 1;
      let group = days.get(m.order);
      if (!group) {
        group = { day: m.day, byMeal: new Map() };
        days.set(m.order, group);
      }
      const eaters = group.byMeal.get(m.mealType) ?? [];
      eaters.push(pi);
      group.byMeal.set(m.mealType, eaters);
    }
  });

  // Eaters are indices, not names: two participants may share a name, and a
  // shared name would merge two different sets into one wrong line.
  const eatersLabel = (indices: number[]): string => {
    if (solo) return "";
    if (indices.length === data.participants.length) {
      return `${t("everyone")} <span style="color:${C.muted};font-size:12px;">(${indices.length})</span>`;
    }
    return indices.map((i) => esc(data.participants[i]!.fullName)).join(" · ");
  };

  const dayBlock = (order: number, group: { day: string; byMeal: Map<string, number[]> }): string => {
    // Meals sharing one set of eaters collapse onto a single line, in the
    // canonical breakfast → lunch → dinner order.
    const served = MEAL_ORDER.filter((type) => group.byMeal.has(type));
    const lines: { meals: string[]; eaters: number[] }[] = [];
    for (const type of served) {
      const eaters = group.byMeal.get(type) ?? [];
      const key = eaters.join(",");
      const existing = lines.find((l) => l.eaters.join(",") === key);
      if (existing) existing.meals.push(type);
      else lines.push({ meals: [type], eaters });
    }

    const rows = lines
      .map(
        (line) => `<tr>
          <td style="padding:5px 14px 5px 0;font-size:14px;color:${C.text};vertical-align:top;white-space:nowrap;width:190px;">${line.meals
            .map((type) => t(type))
            .join(" · ")}</td>
          <td style="padding:5px 0;font-size:14px;color:${C.muted};vertical-align:top;line-height:1.5;">${eatersLabel(line.eaters)}</td>
        </tr>`,
      )
      .join("");

    return `<tr><td style="padding:12px 0 4px;">
        <span style="font-size:13px;font-weight:700;color:${C.heading};">${esc(group.day)}</span>
      </td></tr>
      <tr><td style="padding:0 0 10px;border-bottom:1px solid ${C.line};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      </td></tr>`;
  };

  const mealsByDay =
    mealTotal === 0
      ? `<p style="margin:10px 0 0;font-size:14px;color:${C.muted};">${t("meals_none")}</p>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px;">
      ${[...days.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([order, group]) => dayBlock(order, group))
        .join("")}
      <tr><td align="right" style="padding:10px 0 0;font-size:13px;color:${C.muted};">
        ${t("meals_total")}: <strong style="color:${C.heading};">${mealTotal}</strong>
      </td></tr>
    </table>`;

  const participantsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
      <thead><tr>
        ${th(t("name"))}${th(t("age"))}${th(t("type"))}${th(t("diet"))}${th(t("price"), "right")}
      </tr></thead>
      <tbody>${participantRows}</tbody>
      <tfoot><tr>
        <td colspan="4" align="right" style="padding:12px 10px;font-size:15px;font-weight:700;color:${C.heading};">${t("total")}</td>
        <td align="right" style="padding:12px 10px;font-size:16px;font-weight:700;font-family:${C.mono};color:${C.crimsonDark};white-space:nowrap;">${money(data.totalPrice)}</td>
      </tr></tfoot>
    </table>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta name="x-apple-disable-message-reformatting"/>
  <title>${esc(t("heading"))}</title>
</head>
<body style="margin:0;padding:0;background:${C.page};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="760" cellpadding="0" cellspacing="0" style="width:100%;max-width:760px;background:${C.card};border-radius:10px;overflow:hidden;font-family:${C.font};color:${C.text};">
        <tr><td align="center" style="background:${C.crimson};padding:22px 28px;text-align:center;">
          <span style="font-family:${C.serif};font-size:22px;font-weight:700;color:#ffffff;">${t("heading")}</span>
        </td></tr>
        <tr><td style="padding:26px 28px 28px;">
          ${regNumberBlock}
          <p style="margin:0 0 4px;font-size:15px;color:${C.text};">${t("intro")}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${sectionTitle(t("event"))}
            <tr><td style="padding-top:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${infoRow(t("event"), `<strong>${esc(data.eventTitle)}</strong>`)}
              ${infoRow(t("dates"), esc(formatDateRange(data.eventStart, data.eventEnd, lang)))}
              ${organizerParts ? infoRow(t("organizer"), organizerParts) : ""}
            </table></td></tr>

            ${sectionTitle(t("stay"))}
            <tr><td style="padding-top:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${infoRow(t("arrival"), `${esc(data.arrivalLabel)} · ${t(data.arrivalTime)}`)}
              ${infoRow(t("departure"), esc(data.departureLabel))}
              ${infoRow(t("early_departure"), t(data.earlyDeparture))}
              ${infoRow(t("accommodation"), data.hasAccommodation ? t("yes") : t("no"))}
              ${infoRow(t("center"), esc(data.centerName))}
            </table></td></tr>

            ${sectionTitle(t("meals_by_day"))}
          </table>
          ${mealsByDay}

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${sectionTitle(t("participants"))}
          </table>
          ${participantsTable}

          <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${C.line};font-size:12px;color:${C.faint};line-height:1.5;">${t("gdpr")}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendRegistrationConfirmation(
  data: ConfirmationEmailData,
  lang: Lang,
): Promise<SendResult> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      return { sent: false, error: "RESEND_API_KEY / EMAIL_FROM not configured" };
    }

    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from,
      to: data.to,
      subject: `${TEXT[lang].subject}${data.eventTitle}`,
      html: buildHtml(data, lang),
    });
    if (error) {
      return { sent: false, error: error.message };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}
