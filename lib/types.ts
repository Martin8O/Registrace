// lib/types.ts — shared API request/response shapes (P2 item 4). Frontend and
// backend import the SAME types from here so wire contracts can't drift. Request
// shapes stay Zod-inferred (single source of truth = lib/validation); response
// shapes are the domain DTOs / service results. This file adds no new runtime
// code — it only names and centralizes the contracts.

import type { EventStatusValue } from "@/modules/events";

// ─── Request inputs (Zod-inferred, re-exported for discoverability) ───────────
export type {
  CalculatePriceInput,
  RegistrationSubmitInput,
  RegistrationExportInput,
  EventCreateInput,
  EventCreateWithRelationsInput,
  EventUpdateInput,
  EventStatusInput,
  CenterCreateInput,
} from "@/lib/validation";

// ─── Response payloads (domain DTOs + service results) ────────────────────────
export type {
  PublishedEventDTO,
  EventDetailDTO,
  EventDateDTO,
  EventMealDTO,
  CenterDTO,
  PricingRuleDTO,
  AdminEventListItem,
  EventStatusValue,
  MealTypeValue,
} from "@/modules/events";
export type { PricingResult, PricingResultParticipant } from "@/modules/pricing";
export type { SubmitResult } from "@/modules/registrations";

// Localized public event list item (returned by GET /api/events?lang=cs|en).
export type PublicEventListItem = {
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  centerName: string;
  startDate: string;
  endDate: string;
  status: EventStatusValue;
};

// ─── Wire envelopes used by handlers ──────────────────────────────────────────
export type ApiData<T> = { data: T };
export type ApiList<T> = { data: T[] };
export type ApiError = { error: string };
