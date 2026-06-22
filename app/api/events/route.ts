import { NextRequest, NextResponse } from "next/server";
import { getPublishedEvents } from "@/modules/events";
import type { PublicEventListItem } from "@/lib/types";

// GET /api/events?lang=cs|en — publicly visible (PUBLISHED + not past) events,
// localized. Thin wrapper over the events service (invariant 8).
export async function GET(req: NextRequest) {
  const lang = req.nextUrl.searchParams.get("lang") === "en" ? "en" : "cs";
  const events = await getPublishedEvents();

  const data: PublicEventListItem[] = events.map((e) => ({
    id: e.id,
    title: lang === "en" ? e.title_en : e.title_cs,
    subtitle: lang === "en" ? e.subtitle_en : e.subtitle_cs,
    description: lang === "en" ? e.description_en : e.description_cs,
    centerName: lang === "en" ? e.center.name_en : e.center.name_cs,
    startDate: e.startDate,
    endDate: e.endDate,
    status: e.status,
  }));

  return NextResponse.json({ data });
}
