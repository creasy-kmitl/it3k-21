import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";

import { matchPage } from "@/components/public/test-fixtures";
import { ApiProvider } from "@/lib/api-context";
import { ApiError } from "@/lib/leadership";
import type { PublicCompetitionApi } from "@/lib/public-competition";
import { fakeApis, loudFake } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { MatchView } from "./matches_.$matchId";

afterEach(cleanup);

function setup(api: Partial<PublicCompetitionApi>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const apis = fakeApis({
    publicCompetition: loudFake<PublicCompetitionApi>("publicCompetition", api),
  });
  return renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <MatchView matchId="m-1" />
      </ApiProvider>
    </QueryClientProvider>
  ));
}

describe("match page", () => {
  test("shows the score, period, referees and the timeline first", async () => {
    await setup({ match: async () => matchPage() });
    expect(await screen.findByRole("heading", { name: "ฟุตบอล" })).toBeTruthy();
    expect(screen.getByText("สจล. พบ มจธ.")).toBeTruthy();
    expect(screen.getByText("ครึ่งที่ 2")).toBeTruthy();
    expect(screen.getByText("กรรมการบี")).toBeTruthy();
    expect(screen.getByText("ประตู")).toBeTruthy();
    expect(screen.getByText(/#10 สมชาย/)).toBeTruthy();
  });

  test("lineups show first name and shirt number, starters and subs apart", async () => {
    await setup({ match: async () => matchPage() });
    fireEvent.click(await screen.findByRole("tab", { name: "รายชื่อ" }));
    expect(await screen.findByText("ตัวจริง")).toBeTruthy();
    expect(screen.getByText("ตัวสำรอง")).toBeTruthy();
    expect(screen.getByText("สมศักดิ์")).toBeTruthy();
    expect(screen.getByText("มานะ")).toBeTruthy();
    expect(screen.getByText("โค้ชเอ")).toBeTruthy();
  });

  test("an unknown match says it is not there", async () => {
    await setup({
      match: async () => {
        throw new ApiError(404, "ไม่พบแมตช์นี้");
      },
    });
    expect((await screen.findAllByText("ไม่พบแมตช์นี้")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /ลองใหม่/ })).toBeNull();
  });
});
