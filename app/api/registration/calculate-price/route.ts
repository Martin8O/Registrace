import { NextRequest, NextResponse } from "next/server";
import { calculatePriceSchema } from "@/lib/validation";
import { getPublicEventForDetail } from "@/modules/events";
import { calculatePricing } from "@/modules/pricing";

// POST /api/registration/calculate-price — validate, load the event's pricing
// inputs from the DB (public-visible only — P1 audit H1), and recompute
// server-side via the pricing seam (zeros until P5). Prices are always
// server-authoritative (invariants 3–4). Thin wrapper — no pricing math (inv. 2).
export async function POST(req: NextRequest) {
  const body: unknown = await req.json();
  const result = calculatePriceSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ errors: result.error.flatten() }, { status: 422 });
  }

  const event = await getPublicEventForDetail(result.data.eventId);
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  const pricing = calculatePricing({
    participants: result.data.participants.map((p) => ({
      ageCategory: p.ageCategory,
      pricingType: p.pricingType,
      mealIds: p.mealIds,
    })),
    pricingRules: event.pricingRules,
    meals: event.meals,
    eventDates: event.dates,
    arrivalDateId: result.data.arrivalDateId,
    arrivalTime: result.data.arrivalTime,
    departureDateId: result.data.departureDateId,
    earlyDeparture: result.data.earlyDeparture,
    hasAccommodation: result.data.hasAccommodation,
  });

  return NextResponse.json(pricing);
}
