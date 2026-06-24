import { describe, it, expect } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("joins headers + rows with CRLF and a comma delimiter", () => {
    const out = toCsv({ headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
    expect(out).toBe("a,b\r\n1,2\r\n3,4");
  });

  it("quotes fields with a comma, quote, or newline and doubles inner quotes", () => {
    const out = toCsv({
      headers: ["h"],
      rows: [["x,y"], ['say "hi"'], ["line1\nline2"]],
    });
    expect(out).toBe('h\r\n"x,y"\r\n"say ""hi"""\r\n"line1\nline2"');
  });

  it("stringifies numbers and leaves plain text unquoted", () => {
    const out = toCsv({ headers: ["n", "t"], rows: [[42, "plain"]] });
    expect(out).toBe("n,t\r\n42,plain");
  });
});
