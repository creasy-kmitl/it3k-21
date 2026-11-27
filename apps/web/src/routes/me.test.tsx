import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import { fakeApis, fakeRegistrationsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { SportCheckinCard } from "./me";

afterEach(cleanup);

function setup(code: string | null) {
  const registrations = fakeRegistrationsApi({ checkinCode: async () => ({ code }) });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ registrations })}>
        <SportCheckinCard />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("/me sport check-in code", () => {
  test("an athlete sees their six digits with a barcode", async () => {
    const view = await setup("004213");
    expect(await view.findByText("รหัสเช็คอินกีฬา")).toBeTruthy();
    expect(view.getByText("004213")).toBeTruthy();
    expect(view.getByRole("img", { name: "บาร์โค้ดรหัสเช็คอินกีฬา 004213" })).toBeTruthy();
  });

  test("an account that never registered for a sport sees no card", async () => {
    const view = await setup(null);
    await waitFor(() => expect(view.queryByText("รหัสเช็คอินกีฬา")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.queryByText("รหัสเช็คอินกีฬา")).toBeNull();
  });
});
