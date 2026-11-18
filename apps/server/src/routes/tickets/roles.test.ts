import { expect, test } from "bun:test";
import { ROLES } from "@it3k/auth/permissions";
import { TICKET_ROLES } from "@it3k/db/event-rules";

test("ticket types offer exactly the account roles", () => {
  expect([...TICKET_ROLES].sort()).toEqual([...ROLES].sort());
});
