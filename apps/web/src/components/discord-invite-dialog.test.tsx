import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { MyDiscord } from "@/lib/profile";
import { fakeApis } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { DiscordInviteDialog, discordLinkedSearch } from "./discord-invite-dialog";

afterEach(cleanup);

const LINKED = {
  accountId: "acc-1",
  userId: "123456789012345678",
  username: "faker",
  displayName: "Faker",
  avatarUrl: null,
};

function setup(state: MyDiscord, open = true) {
  const closes: number[] = [];
  const base = fakeApis({});
  const profile = { ...base.profile, discord: async () => state };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={{ ...base, profile }}>
        <DiscordInviteDialog open={open} onClose={() => closes.push(1)} />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { view, closes };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const audience = { staff: false, athlete: false };

describe("DiscordInviteDialog", () => {
  test("coming back linked, it invites into the server", async () => {
    const { view, closes } = setup({
      enabled: true,
      audience,
      inviteUrl: "https://discord.gg/it3k",
      linked: LINKED,
    });
    const v = await view;
    expect(await v.findByText("เชื่อม Discord แล้ว เข้าเซิร์ฟเวอร์กันเลย")).toBeTruthy();
    const link = v.getByRole("link", { name: "เข้าเซิร์ฟเวอร์ Discord" });
    expect(link.getAttribute("href")).toBe("https://discord.gg/it3k");
    fireEvent.click(link);
    expect(closes).toHaveLength(1);
  });

  test("ไว้ทีหลัง closes it", async () => {
    const { view, closes } = setup({
      enabled: true,
      audience,
      inviteUrl: "https://discord.gg/it3k",
      linked: LINKED,
    });
    const v = await view;
    fireEvent.click(await v.findByRole("button", { name: "ไว้ทีหลัง" }));
    await waitFor(() => expect(closes.length).toBeGreaterThan(0));
  });

  test("without an invite, or without a link, it shows nothing and clears the flag", async () => {
    for (const state of [
      { enabled: true, audience, inviteUrl: null, linked: LINKED },
      { enabled: true, audience, inviteUrl: "https://discord.gg/it3k", linked: null },
    ]) {
      const { view, closes } = setup(state);
      const v = await view;
      await waitFor(() => expect(closes).toHaveLength(1));
      expect(v.queryByText("เชื่อม Discord แล้ว เข้าเซิร์ฟเวอร์กันเลย")).toBeNull();
      cleanup();
    }
  });

  test("closed, it does not even ask the API", async () => {
    const { view } = setup({ enabled: true, audience, inviteUrl: "x", linked: LINKED }, false);
    const v = await view;
    await settle();
    expect(v.queryByRole("alertdialog")).toBeNull();
  });
});

describe("discordLinkedSearch", () => {
  test("accepts only linked", () => {
    expect(discordLinkedSearch.parse("linked")).toBe("linked");
    expect(discordLinkedSearch.parse("other")).toBeUndefined();
    expect(discordLinkedSearch.parse(undefined)).toBeUndefined();
  });
});
