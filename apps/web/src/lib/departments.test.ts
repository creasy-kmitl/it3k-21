import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { departmentsApi } from "./departments";
import { ApiError, isSignedOut } from "./leadership";

let fetched: ReturnType<typeof spyOn> | undefined;
afterEach(() => fetched?.mockRestore());

function respond(body: unknown, status: number) {
  fetched = spyOn(globalThis, "fetch").mockImplementation((() =>
    Promise.resolve(Response.json(body, { status }))) as never);
}

describe("departmentsApi", () => {
  test("reports an ended session as signed out, so the page can send the visitor to sign in", async () => {
    respond({ message: "Unauthorized" }, 401);
    const error = await departmentsApi.remove("d-art").catch((thrown: unknown) => thrown);
    expect(isSignedOut(error)).toBe(true);
  });

  test("keeps the server's message for other failures", async () => {
    respond({ message: "Name already taken" }, 409);
    const error = await departmentsApi.create({ name: "Art" }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ApiError);
    expect(isSignedOut(error)).toBe(false);
    expect((error as ApiError).message).toBe("Name already taken");
  });
});
