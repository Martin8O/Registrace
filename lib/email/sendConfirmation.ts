// lib/email — registration-confirmation email via Resend (invariant 6:
// email-only, never throws, a failure must never block or roll back the DB
// write). P6: production bilingual template — a responsive (≤600px, table-based,
// fully inline CSS, no external resources) HTML mail rendered in ONE language
// chosen by `lang`. The text lives in a small inline cs/en map because email
// rendering happens outside the next-intl request scope. Both call sites (submit
// + admin resend) feed it via the DRY builder in modules/registrations.

import { Resend } from "resend";

export type ConfirmationParticipant = {
  fullName: string;
  ageCategory: string;
  pricingType?: string; // present only for AGE_15_PLUS (invariant 15)
  meals: string[]; // localized meal labels
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

const TEXT: Record<Lang, Record<string, string>> = {
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
// the element. Layout is table-based with width:100% + max-width:600px for
// resilient rendering down to phone widths. Web fonts can't load in email, so
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

function buildHtml(data: ConfirmationEmailData, lang: Lang): string {
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
      const meals = p.meals.length > 0 ? p.meals.map(esc).join(", ") : t("none_dash");
      const type = p.pricingType ? t(p.pricingType) : t("none_dash");
      return `<tr>
        <td style="${cell}">${esc(p.fullName)}</td>
        <td style="${cell}">${t(p.ageCategory)}</td>
        <td style="${cell}">${type}</td>
        <td style="${cell}">${meals}</td>
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

  const participantsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
      <thead><tr>
        ${th(t("name"))}${th(t("age"))}${th(t("type"))}${th(t("meals"))}${th(t("price"), "right")}
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
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${C.card};border-radius:10px;overflow:hidden;font-family:${C.font};color:${C.text};">
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
