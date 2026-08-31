// What one meal costs one person — the single definition of that lookup.
//
// Lives in lib/utils (pure, client-safe, no Prisma) rather than inside
// modules/pricing because three callers need the SAME answer and any drift
// between them is a wrong price on someone's screen or invoice:
//   • modules/pricing — the authoritative engine (invariants 2–4);
//   • modules/registrations — the ParticipantMeal.price snapshot at submit;
//   • components/public/RegistrationForm — the informational price on each meal
//     pill, which a client component cannot get from the server-only engine.
// This is a table lookup, not pricing policy: the engine still owns every rule
// about days, discounts, accommodation and totals. It mirrors the existing
// lib/utils/mealAvailability split (pure shared logic the form and server agree on).

export type MealPriceRule = {
  mealType: string;
  ageCategory: string;
  pricingType: string;
  price: number;
};

// A meal is priced by the MEAL tier, which since M40 is chosen independently of
// the participation/accommodation tier. The field is named for that explicitly so
// no caller can pass the wrong one of the two without the type telling it off.
export type MealPriceWho = {
  ageCategory: string;
  mealPricingType?: string;
};

// The meal tier to use for an INCOMING payload participant (public form → submit
// or calculate-price). A payload written before the meal tier existed carries only
// one tier, and that tier priced its meals too — so the fallback is that
// participant's own participation tier, NEVER STANDARD. Falling back to STANDARD
// would quietly re-price a supported or surplus person's meals downward.
//
// This is backward compatibility, not the inference the design rejects: the two
// CHOICES stay unlinked, this only reconstructs a choice an old client never made.
// It fires between M40a and M40c (the public form still sends one tier) and, after
// that, only for a stale cached client during a deploy window.
// Generic over the tier type so a caller holding the narrow enum union keeps it —
// the submit service stores the result straight onto Participant.mealPricingType,
// which is a Prisma enum, not a bare string.
export function effectiveMealPricingType<T extends string>(participant: {
  pricingType?: T;
  mealPricingType?: T;
}): T | undefined {
  return participant.mealPricingType ?? participant.pricingType;
}

// Price of `mealType` for `who`, from the event's meal price list.
//
// `fallbackPrice` is the meal slot's legacy flat price and is used ONLY when the
// event has no price list at all (invariant 21) — i.e. it predates M37 and the
// backfill missed it. It is deliberately NOT used when the list exists but has no
// row for this exact combination: that would turn a genuine gap into a silent
// full-price charge. A configured event always has all 12 rows per meal type, so
// a missing one means the list is incomplete, and 0 is the safe, visible answer.
export function resolveMealPrice(
  mealType: string,
  who: MealPriceWho,
  mealPricingRules: readonly MealPriceRule[] | undefined,
  fallbackPrice: number,
): number {
  if (!mealPricingRules || mealPricingRules.length === 0) return fallbackPrice;

  const mealPricingType = who.mealPricingType ?? "STANDARD";
  const rule = mealPricingRules.find(
    (r) =>
      r.mealType === mealType &&
      r.ageCategory === who.ageCategory &&
      r.pricingType === mealPricingType,
  );
  return rule?.price ?? 0;
}
