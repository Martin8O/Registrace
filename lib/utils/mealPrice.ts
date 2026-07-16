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

export type MealPriceWho = {
  ageCategory: string;
  pricingType?: string;
};

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

  const pricingType = who.pricingType ?? "STANDARD";
  const rule = mealPricingRules.find(
    (r) =>
      r.mealType === mealType &&
      r.ageCategory === who.ageCategory &&
      r.pricingType === pricingType,
  );
  return rule?.price ?? 0;
}
