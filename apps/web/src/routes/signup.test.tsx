import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY_PROFILE } from "@it3k/db/profile";
import { ApiProvider } from "@/lib/api-context";
import type { MyProfile } from "@/lib/profile";
import { fakeApis } from "@/test/query";
import { renderAtRoot } from "@/test/router";
import { SignupEditor } from "./signup";

afterEach(cleanup);
function draft(revision: number, firstName: string): MyProfile {
  return {
    account: {
      id: "guest",
      email: "guest@example.com",
      name: "Guest",
      image: null,
      role: "guest",
      roles: ["guest"],
      createdAt: new Date().toISOString(),
      departmentId: null,
      seatRole: null,
    },
    draft: { ...EMPTY_PROFILE, firstName },
    profile: null,
    revision,
    hasDraft: true,
    submittedAt: null,
  };
}

test("every editor visit waits for the current draft and saves with its revision", async () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  query.setQueryData(["profile", "me", "guest"], draft(0, "Stale cached draft"));
  let response = Promise.withResolvers<MyProfile>();
  let reads = 0;
  const saves: { revision: number; firstName: string }[] = [];
  const apis = fakeApis({
    profile: {
      me: async (userId) => {
        expect(userId).toBe("guest");
        reads++;
        return response.promise;
      },
      saveDraft: async (revision, values, userId) => {
        expect(userId).toBe("guest");
        saves.push({ revision, firstName: values.firstName });
        return { revision: revision + 1 };
      },
      submit: async () => {
        throw new Error("Unexpected submit");
      },
    },
  });
  const view = await renderAtRoot(
    () => (
      <QueryClientProvider client={query}>
        <ApiProvider value={apis}>
          <SignupEditor userId="guest" onComplete={async () => {}} />
        </ApiProvider>
      </QueryClientProvider>
    ),
    "/signup",
  );
  expect(screen.queryByLabelText("ชื่อ")).toBeNull();
  await act(async () => response.resolve(draft(4, "Fresh draft")));
  expect(await screen.findByDisplayValue("Fresh draft")).toBeDefined();
  fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "First visit edit" } });
  await act(async () => {
    await view.router.navigate({ to: "/" });
  });
  expect(saves).toEqual([{ revision: 4, firstName: "First visit edit" }]);

  response = Promise.withResolvers<MyProfile>();
  await act(async () => {
    await view.router.navigate({ to: "/signup" });
  });
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.queryByLabelText("ชื่อ")).toBeNull();
  await act(async () => response.resolve(draft(9, "Latest returning draft")));
  expect(await screen.findByDisplayValue("Latest returning draft")).toBeDefined();
  fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "Second visit edit" } });
  await act(async () => {
    await view.router.navigate({ to: "/" });
  });
  expect(saves.at(-1)).toEqual({ revision: 9, firstName: "Second visit edit" });
});

test("a background profile refresh preserves the open editor's values and revision", async () => {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current = draft(2, "Initial draft");
  let offline = false;
  const saves: number[] = [];
  const apis = fakeApis({
    profile: {
      me: async () => {
        if (offline) throw new Error("Offline");
        return current;
      },
      saveDraft: async (revision) => {
        saves.push(revision);
        return { revision: revision + 1 };
      },
      submit: async () => {
        throw new Error("Unexpected submit");
      },
    },
  });
  const view = await renderAtRoot(
    () => (
      <QueryClientProvider client={query}>
        <ApiProvider value={apis}>
          <SignupEditor userId="guest" onComplete={async () => {}} />
        </ApiProvider>
      </QueryClientProvider>
    ),
    "/signup",
  );
  await screen.findByDisplayValue("Initial draft");
  fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "Local edit" } });
  current = draft(8, "Another tab's edit");
  await act(async () => {
    await query.invalidateQueries({ queryKey: ["profile"] });
  });
  expect(screen.getByDisplayValue("Local edit")).toBeDefined();
  expect(screen.queryByDisplayValue("Another tab's edit")).toBeNull();
  offline = true;
  await act(async () => {
    await query.invalidateQueries({ queryKey: ["profile"] });
  });
  await waitFor(() =>
    expect(
      query.getQueryCache().find({ queryKey: ["profile", "editor"], exact: false })?.state.status,
    ).toBe("error"),
  );
  expect(screen.getByDisplayValue("Local edit")).toBeDefined();
  await act(async () => {
    await view.router.navigate({ to: "/" });
  });
  expect(saves).toEqual([2]);
});
