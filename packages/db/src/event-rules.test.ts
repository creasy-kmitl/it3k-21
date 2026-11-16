import { describe, expect, test } from "bun:test";

import { TICKET_CODE_PATTERN, TICKET_QR_PREFIX, newTicketCode, parseScan } from "./event-rules";

describe("ticket codes", () => {
  test("new codes are well-formed and different each time", () => {
    const codes = new Set(Array.from({ length: 50 }, () => newTicketCode()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(TICKET_CODE_PATTERN);
  });

  test("a scan is a ticket's QR or a profile barcode", () => {
    const code = newTicketCode();
    expect(parseScan(`${TICKET_QR_PREFIX}${code}`)).toEqual({ ticketCode: code });
    // Some scanners shout in capitals or add whitespace.
    expect(parseScan(` IT3K-T:${code}\n`)).toEqual({ ticketCode: code });
    expect(parseScan(" user-123 ")).toEqual({ userId: "user-123" });
  });
});
