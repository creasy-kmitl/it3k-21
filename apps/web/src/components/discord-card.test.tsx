import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { MyDiscord, ProfileApi } from "@/lib/profile";
import { fakeApis, fakeRegistrationsApi } from "@/test/query";
import { renderAtRoot } from "@/test/router";

import { DiscordCard, perksFor } from "./discord-card";

afterEach(cleanup);

const STAFF = { staff: true, athlete: false };
const ATHLETE = { staff: false, athlete: true };
const NOBODY = { staff: false, athlete: false };

const LINKED = {
  accountId: "acc-1",
  userId: "123456789012345678",
  username: "faker",
  displayName: "Faker",
  avatarUrl: null,
  guildsJoin: true,
};

type JoinResult = Awaited<ReturnType<ProfileApi["joinDiscordGuild"]>>;

function setup(
  initial: Omit<MyDiscord, "canJoinGuild"> & { canJoinGuild?: boolean },
  joinResult: JoinResult = { status: "joined", url: "https://discord.com/channels/42" },
) {
  let state: MyDiscord = { canJoinGuild: false, ...initial };
  const calls = { link: [] as string[], unlink: [] as string[], join: 0 };
  const registrations = fakeRegistrationsApi({
    linkDiscord: async (returnTo) => {
      calls.link.push(returnTo);
    },
    unlinkDiscord: async (accountId) => {
      calls.unlink.push(accountId);
      state = { ...state, linked: null };
    },
  });
  const base = fakeApis({ registrations });
  const profile = {
    ...base.profile,
    discord: async () => state,
    joinDiscordGuild: async () => {
      calls.join += 1;
      return joinResult;
    },
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderAtRoot(() => (
    <QueryClientProvider client={client}>
      <ApiProvider value={{ ...base, profile }}>
        <DiscordCard />
      </ApiProvider>
    </QueryClientProvider>
  ));
  return { view, calls };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("Discord card", () => {
  test("an athlete without Discord sees what linking brings and links, coming back to /me", async () => {
    const { view, calls } = setup({ enabled: true, audience: ATHLETE, linked: null });
    const v = await view;
    expect(await v.findByText("ยังไม่ได้เชื่อม")).toBeTruthy();
    expect(v.getByText("ห้องทีมของสถาบัน")).toBeTruthy();
    expect(v.queryByText("ยศ Staff")).toBeNull();
    fireEvent.click(v.getByRole("button", { name: "เชื่อม Discord" }));
    await waitFor(() => expect(calls.link).toEqual([`${window.location.origin}/me`]));
  });

  test("a linked account shows its Discord name and unlinks after confirming", async () => {
    const { view, calls } = setup({ enabled: true, audience: STAFF, linked: LINKED });
    const v = await view;
    expect(await v.findByText("Faker")).toBeTruthy();
    expect(v.getByText("@faker")).toBeTruthy();
    expect(v.getByText("เชื่อมแล้ว")).toBeTruthy();

    fireEvent.click(v.getByRole("button", { name: "ยกเลิกการเชื่อม" }));
    expect(await v.findByText("ยกเลิกการเชื่อม Discord?")).toBeTruthy();
    expect(calls.unlink).toEqual([]);
    const buttons = v.getAllByRole("button", { name: "ยกเลิกการเชื่อม" });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(calls.unlink).toEqual(["acc-1"]));
    expect(await v.findByText("ยังไม่ได้เชื่อม")).toBeTruthy();
  });

  test("a linked account joins the guild from the card", async () => {
    const { view, calls } = setup({
      enabled: true,
      audience: ATHLETE,
      canJoinGuild: true,
      linked: LINKED,
    });
    const v = await view;
    fireEvent.click(await v.findByRole("button", { name: "เข้าเซิร์ฟเวอร์ Discord" }));
    await waitFor(() => expect(calls.join).toBe(1));
    expect(calls.link).toEqual([]);
  });

  test("a link without guilds.join is sent back to Discord for consent", async () => {
    const { view, calls } = setup(
      {
        enabled: true,
        audience: STAFF,
        canJoinGuild: true,
        linked: { ...LINKED, guildsJoin: false },
      },
      { status: "consent" },
    );
    const v = await view;
    fireEvent.click(await v.findByRole("button", { name: "เข้าเซิร์ฟเวอร์ Discord" }));
    await waitFor(() => expect(calls.link).toEqual([`${window.location.origin}/me`]));
  });

  test("no join button where this stage cannot join the guild", async () => {
    const { view } = setup({ enabled: true, audience: STAFF, linked: LINKED });
    const v = await view;
    expect(await v.findByText("Faker")).toBeTruthy();
    expect(v.queryByRole("button", { name: "เข้าเซิร์ฟเวอร์ Discord" })).toBeNull();
    expect(v.getByText("✅・verify")).toBeTruthy();
  });

  test("hidden from accounts the esports Discord is not for, even when linked", async () => {
    const { view } = setup({ enabled: true, audience: NOBODY, linked: LINKED });
    const v = await view;
    await settle();
    expect(v.queryByText("Discord Esport")).toBeNull();
  });

  test("hidden while Discord is turned off and nothing is linked", async () => {
    const { view } = setup({ enabled: false, audience: STAFF, linked: null });
    const v = await view;
    await settle();
    expect(v.queryByText("Discord Esport")).toBeNull();
  });
});

describe("perksFor", () => {
  test("staff and athletes each see their own perks; everyone gets the nickname", () => {
    const labels = (audience: MyDiscord["audience"]) => perksFor(audience).map((p) => p.label);
    expect(labels(STAFF)).toContain("ยศ Staff");
    expect(labels(STAFF)).not.toContain("ยศเกมที่ลงแข่ง");
    expect(labels(ATHLETE)).toContain("ยศเกมที่ลงแข่ง");
    expect(labels(ATHLETE)).not.toContain("พาเข้าเซิร์ฟเวอร์ให้อัตโนมัติ");
    expect(perksFor(ATHLETE, true).map((p) => p.label)).toContain("พาเข้าเซิร์ฟเวอร์ให้อัตโนมัติ");
    expect(labels({ staff: true, athlete: true })).toEqual(
      expect.arrayContaining(["ยศ Staff", "ยศเกมที่ลงแข่ง", "ชื่อในดิสตั้งให้อัตโนมัติ"]),
    );
  });
});
