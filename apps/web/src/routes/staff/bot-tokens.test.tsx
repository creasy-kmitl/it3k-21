import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

import type { BotToken, BotTokensApi, IssuedBotToken } from "@/lib/bot-tokens";
import type { Me } from "@/lib/users";
import { fakeUsersApi, loudFake, renderRoute } from "@/test/query";

import { Route } from "./bot-tokens";

afterEach(cleanup);

function me(canManageBotTokens: boolean): Me {
  return {
    id: "me",
    role: canManageBotTokens ? "admin" : "staff",
    department: null,
    seatRole: null,
    canManageUsers: false,
    canManageDepartments: false,
    assignableKinds: [],
    institution: null,
    sportAccess: { permissions: [], scope: { kind: "none" } },
    canSendEmail: false,
    canManageBotTokens,
    viewingAs: false,
  };
}

const token = (overrides: Partial<BotToken> = {}): BotToken => ({
  id: "tok-1",
  name: "esport bot",
  prefix: "it3kbot_AbCd",
  createdAt: "2026-11-27T10:00:00.000Z",
  lastUsedAt: null,
  revokedAt: null,
  createdByName: "Admin",
  ...overrides,
});

function render(canManage: boolean, botTokens: Partial<BotTokensApi> = {}) {
  return renderRoute(Route, {
    users: fakeUsersApi({ me: async () => me(canManage) }),
    botTokens: loudFake<BotTokensApi>("botTokens", botTokens),
  });
}

describe("bot tokens page", () => {
  test("non-admins are told they have no right, and nothing is loaded", async () => {
    const list = mock(async () => ({ items: [] }));
    render(false, { list });
    expect(await screen.findByText("เฉพาะผู้ดูแลระบบที่จัดการ bot token ได้")).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  test("lists tokens by prefix, with revoke only for live ones", async () => {
    render(true, {
      list: async () => ({
        items: [
          token(),
          token({ id: "tok-2", name: "old bot", revokedAt: "2026-11-27T11:00:00.000Z" }),
        ],
      }),
    });
    expect(await screen.findByText("esport bot")).toBeTruthy();
    expect(screen.getAllByText("it3kbot_AbCd…")).toHaveLength(2);
    expect(screen.getByText("เพิกถอนแล้ว")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "เพิกถอน" })).toHaveLength(1);
  });

  test("issuing shows the token once", async () => {
    const issued: IssuedBotToken = {
      ...token(),
      createdByName: "Admin",
      token: "it3kbot_secret-value",
    };
    const issue = mock(async () => issued);
    render(true, { list: async () => ({ items: [] }), issue });
    fireEvent.click(await screen.findByRole("button", { name: "ออก token ใหม่" }));

    // A name is required.
    fireEvent.click(screen.getByRole("button", { name: "ออก token" }));
    expect(await screen.findByText("กรุณาตั้งชื่อ")).toBeTruthy();
    expect(issue).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "esport bot" } });
    fireEvent.click(screen.getByRole("button", { name: "ออก token" }));
    await waitFor(() => expect(issue).toHaveBeenCalledWith({ name: "esport bot" }));
    expect((await screen.findByTestId("issued-token")).textContent).toBe("it3kbot_secret-value");
  });

  test("revoking asks first", async () => {
    const revoke = mock(async () => token({ revokedAt: "2026-11-27T12:00:00.000Z" }));
    render(true, { list: async () => ({ items: [token()] }), revoke });
    fireEvent.click(await screen.findByRole("button", { name: "เพิกถอน" }));
    expect(await screen.findByText("เพิกถอน esport bot?")).toBeTruthy();
    expect(revoke).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole("button", { name: "เพิกถอน" });
    fireEvent.click(buttons[buttons.length - 1] as HTMLElement);
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("tok-1"));
  });
});
