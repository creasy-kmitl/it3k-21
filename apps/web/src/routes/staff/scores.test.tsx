import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { ScoresPage } from "@/components/scores/scores-page";
import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { Match, MatchesApi, MatchInput, MatchUpdate } from "@/lib/matches";
import { fakeApis, fakeMatchesApi, match } from "@/test/query";

afterEach(cleanup);

/** The scores page in a memory router, so its link to the public board renders. */
async function setup(api: Partial<MatchesApi>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const root = createRootRoute({ component: Outlet });
  const routes = [
    createRoute({ getParentRoute: () => root, path: "/", component: ScoresPage }),
    createRoute({ getParentRoute: () => root, path: "/scores", component: () => <p>board</p> }),
  ];
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(() => router.load());
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider value={fakeApis({ matches: fakeMatchesApi(api) })}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  );
}

describe("staff scores page", () => {
  test("lists matches with their scores", async () => {
    await setup({
      list: async () => ({ items: [match({ scoreA: 2, scoreB: 1, status: "finished" })] }),
    });
    expect(await screen.findByText("ฟุตบอล")).toBeDefined();
    expect(screen.getByLabelText("คะแนน มจธ.").textContent).toBe("2");
    expect(screen.getByLabelText("คะแนน สจล.").textContent).toBe("1");
    expect(screen.queryByLabelText("เพิ่มคะแนน มจธ.")).toBeNull();
  });

  test("+ on a live match saves the next score with the version it read", async () => {
    let items: Match[] = [match({ id: "m1", scoreA: 1, scoreB: 0, status: "live", version: 4 })];
    const sent: { id: string; input: MatchUpdate }[] = [];
    await setup({
      list: async () => ({ items }),
      update: async (id, input) => {
        sent.push({ id, input });
        items = [{ ...(items[0] as Match), scoreA: 2, version: 5 }];
        return items[0] as Match;
      },
    });
    fireEvent.click(await screen.findByLabelText("เพิ่มคะแนน มจธ."));
    await waitFor(() => expect(screen.getByLabelText("คะแนน มจธ.").textContent).toBe("2"));
    expect(sent).toEqual([{ id: "m1", input: { version: 4, scoreA: 2 } }]);
  });

  test("a stale edit reloads the list", async () => {
    let loads = 0;
    await setup({
      list: async () => {
        loads++;
        return { items: [match({ status: "live", scoreA: 0, scoreB: 0 })] };
      },
      update: async () => {
        throw new ApiError(409, "stale", null);
      },
    });
    fireEvent.click(await screen.findByLabelText("เพิ่มคะแนน สจล."));
    await waitFor(() => expect(loads).toBe(2));
  });

  test("adds a match from the form", async () => {
    const created: MatchInput[] = [];
    await setup({
      create: async (input) => {
        created.push(input);
        return match();
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มแมตช์" }));
    fireEvent.change(await screen.findByLabelText("กีฬา"), { target: { value: " วอลเลย์บอล " } });
    fireEvent.change(screen.getByLabelText("คะแนนทีม A"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      sport: "วอลเลย์บอล",
      teamA: "kmutt",
      teamB: "kmutnb",
      scoreA: 3,
      scoreB: null,
      status: "scheduled",
    });
  });

  test("refuses a score that is not a whole number", async () => {
    await setup({});
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มแมตช์" }));
    fireEvent.change(await screen.findByLabelText("กีฬา"), { target: { value: "ฟุตบอล" } });
    fireEvent.change(screen.getByLabelText("คะแนนทีม A"), { target: { value: "1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    expect(await screen.findByText(/คะแนนต้องเป็นจำนวนเต็ม/)).toBeDefined();
  });
});
