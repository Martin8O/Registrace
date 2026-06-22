import { NextResponse } from "next/server";
import type { ZodError } from "zod";

// The single source of the validation-error contract (P3): every endpoint that
// rejects a body via Zod returns THIS shape, so the contract can't drift.
//
// HTTP 400 + { error, details } where details = ZodError.issues — a flat array
// in which each issue keeps its full `path` (e.g. ["participants", 0,
// "fullName"]). That preserves nested addressability that `error.flatten()`
// (the pre-P3 shape) collapsed to the top level. The payload carries field
// paths + messages + Zod codes only — never the submitted values.
export function validationError(error: ZodError): NextResponse {
  return NextResponse.json(
    { error: "Validation failed", details: error.issues },
    { status: 400 },
  );
}
