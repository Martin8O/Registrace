// lib/email — basic registration-confirmation email via Resend (invariant 6:
// email-only, never throws, a failure must never block or roll back the DB
// write). The body is plain inline HTML in ONE language chosen by `lang`; the
// text lives in a small inline cs/en map because email rendering is outside
// the next-intl request scope.
// TODO(P6): polished bilingual templates + admin manual-resend wiring.

import { Resend } from "resend";

export type ConfirmationParticipant = {
  fullName: string;
  ageCategory: string;
  pricingType?: string; // present only for AGE_15_PLUS (invariant 15)
  meals: string[]; // localized meal labels
  subtotal: number; // whole CZK (invariant 10)
};

export type ConfirmationEmailData = {
  registrationId: string;
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
    intro: "Děkujeme, vaše registrace byla přijata.",
    event: "Akce",
    organizer: "Kontakt na pořadatele",
    arrival: "Příjezd",
    departure: "Odjezd",
    early_departure: "Dřívější odjezd",
    accommodation: "Ubytování",
    center: "Centrum",
    participants: "Účastníci",
    meals: "Strava",
    subtotal: "Mezisoučet",
    total: "Celkem k úhradě",
    registration_id: "Číslo registrace",
    gdpr: "Vaše osobní údaje zpracováváme v souladu se zásadami ochrany osobních údajů (kontakt: info@bdc.cz).",
    yes: "ano",
    no: "ne",
    MORNING: "ráno",
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
    intro: "Thank you, your registration has been received.",
    event: "Event",
    organizer: "Organizer contact",
    arrival: "Arrival",
    departure: "Departure",
    early_departure: "Early departure",
    accommodation: "Accommodation",
    center: "Centre",
    participants: "Participants",
    meals: "Meals",
    subtotal: "Subtotal",
    total: "Total due",
    registration_id: "Registration ID",
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

// Event days are stored as UTC midnight; formatting in Europe/Prague keeps the
// same calendar day (invariant 11).
function formatDay(date: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "cs" ? "cs-CZ" : "en-GB", {
    dateStyle: "long",
    timeZone: "Europe/Prague",
  }).format(date);
}

function buildHtml(data: ConfirmationEmailData, lang: Lang): string {
  const t = (key: string): string => TEXT[lang][key] ?? key;
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#555;">${label}</td><td style="padding:4px 0;">${value}</td></tr>`;

  const organizerParts = [data.contactName, data.contactPhone, data.contactEmail]
    .filter((v): v is string => v !== null && v !== "")
    .map(esc)
    .join(" · ");

  const participantBlocks = data.participants
    .map((p) => {
      const typeSuffix = p.pricingType ? `, ${t(p.pricingType)}` : "";
      const meals = p.meals.length > 0 ? p.meals.map(esc).join(", ") : "—";
      return `<li style="margin-bottom:8px;">
        <strong>${esc(p.fullName)}</strong> (${t(p.ageCategory)}${typeSuffix})<br/>
        ${t("meals")}: ${meals}<br/>
        ${t("subtotal")}: ${p.subtotal} CZK
      </li>`;
    })
    .join("");

  return `
  <div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#222;">
    <h1 style="font-size:20px;border-bottom:2px solid #b08d36;padding-bottom:8px;">${t("heading")}</h1>
    <p>${t("intro")}</p>
    <table style="border-collapse:collapse;font-size:14px;">
      ${row(t("event"), `<strong>${esc(data.eventTitle)}</strong> (${formatDay(data.eventStart, lang)} – ${formatDay(data.eventEnd, lang)})`)}
      ${organizerParts ? row(t("organizer"), organizerParts) : ""}
      ${row(t("arrival"), `${esc(data.arrivalLabel)} (${t(data.arrivalTime)})`)}
      ${row(t("departure"), esc(data.departureLabel))}
      ${row(t("early_departure"), t(data.earlyDeparture))}
      ${row(t("accommodation"), data.hasAccommodation ? t("yes") : t("no"))}
      ${row(t("center"), esc(data.centerName))}
    </table>
    <h2 style="font-size:16px;margin-top:20px;">${t("participants")}</h2>
    <ul style="font-size:14px;padding-left:20px;">${participantBlocks}</ul>
    <p style="font-size:16px;"><strong>${t("total")}: ${data.totalPrice} CZK</strong></p>
    <p style="font-size:13px;color:#555;">${t("registration_id")}: ${esc(data.registrationId)}</p>
    <p style="font-size:12px;color:#888;margin-top:20px;">${t("gdpr")}</p>
  </div>`;
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
