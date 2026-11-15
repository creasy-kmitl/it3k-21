import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { EMPTY_PROFILE, GiB, INSTITUTIONS, type ProfileValues } from "@it3k/db/profile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiProvider } from "@/lib/api-context";
import type { MyProfile, ProfileApi } from "@/lib/profile";
import { ApiError } from "@/lib/leadership";
import { createAuthClient } from "better-auth/react";
import { SignOutGuardProvider } from "@/lib/sign-out-guard";
import { fakeApis, choose } from "@/test/query";
import { renderAtRoot } from "@/test/router";
import { ParticipantForm } from "./participant-form";
import UserMenu, { type UserMenuClient } from "./user-menu";
import { SessionBoundary, type SessionObserver } from "./session-boundary";

afterEach(cleanup);
async function setup(
  draft: ProfileValues | null = null,
  overrides: Partial<ProfileApi> = {},
  menuClient?: UserMenuClient & SessionObserver,
) {
  const saves: ProfileValues[] = [];
  const revisions: number[] = [];
  const submits: ProfileValues[] = [];
  const data: MyProfile = {
    account: {
      id: "guest",
      email: "student@kmitl.ac.th",
      name: "Student",
      image: null,
      role: "guest",
      roles: ["guest"],
      createdAt: new Date().toISOString(),
      departmentId: null,
      seatRole: null,
    },
    draft,
    profile: null,
    revision: 0,
    hasDraft: !!draft,
    submittedAt: null,
  };
  const apis = fakeApis({
    profile: {
      me: async () => data,
      saveDraft: async (revision, values) => {
        saves.push(values);
        revisions.push(revision);
        return { revision: revision + 1 };
      },
      submit: async (input) => {
        submits.push(input.values);
        return { revision: input.revision + 1 };
      },
      ...overrides,
    },
    files: {
      list: async () => ({
        items: [
          {
            id: "4bca8f6e-5565-4d57-a216-a6dde11ca2e4",
            name: "face.png",
            size: 100,
            contentType: "image/png",
            url: "/face.png",
            createdAt: new Date().toISOString(),
          },
        ],
        uploads: [],
        page: 1,
        hasMore: false,
        used: 100,
        limit: GiB,
      }),
      remove: async () => ({ success: true }),
      upload: async () => ({ id: crypto.randomUUID() }),
    },
  });
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = await renderAtRoot(() => {
    const content = (
      <SignOutGuardProvider>
        {menuClient && <UserMenu client={menuClient} />}
        <ParticipantForm data={data} onComplete={async () => undefined} />
      </SignOutGuardProvider>
    );
    return (
      <QueryClientProvider client={query}>
        <ApiProvider value={apis}>
          {menuClient ? (
            <SessionBoundary userId={data.account.id} client={menuClient}>
              {content}
            </SessionBoundary>
          ) : (
            content
          )}
        </ApiProvider>
      </QueryClientProvider>
    );
  }, "/signup");
  if (menuClient) await view.findByLabelText("ชื่อ");
  return { ...view, saves, submits, revisions, data, query };
}

test("registration validates required fields and optional health inputs exist", async () => {
  const view = await setup();
  fireEvent.click(view.getByRole("button", { name: "ยืนยันลงทะเบียนผู้เข้าร่วม" }));
  expect(await view.findByText("กรอกชื่อ")).toBeTruthy();
  for (const label of ["โรคประจำตัว", "ประวัติการแพ้ยา", "อาหารที่แพ้", "ข้อจำกัดด้านอาหาร"])
    expect(view.getByLabelText(label)).toBeTruthy();
  expect(view.submits).toEqual([]);
});
test("saved institution wins over the Google email suggestion and stays editable", async () => {
  const view = await setup({ ...EMPTY_PROFILE, institution: "kmutt", firstName: "Saved" });
  expect(view.getByLabelText("ชื่อ")).toHaveProperty("value", "Saved");
  expect(view.getByRole("combobox", { name: "มหาวิทยาลัย/สถาบัน" })).toHaveProperty(
    "value",
    INSTITUTIONS[1].name,
  );
  await choose(view.getByRole("button", { name: "เลือกมหาวิทยาลัย/สถาบัน" }), INSTITUTIONS[3].name);
  expect(view.getByRole("combobox", { name: "มหาวิทยาลัย/สถาบัน" })).toHaveProperty(
    "value",
    INSTITUTIONS[3].name,
  );
});
test("an incomplete edit is debounced and autosaved", async () => {
  const view = await setup();
  fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "First" } });
  fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "Latest" } });
  expect(view.saves).toEqual([]);
  await waitFor(() => expect(view.saves).toHaveLength(1), { timeout: 1500 });
  expect(view.saves[0]?.firstName).toBe("Latest");
  expect(view.saves[0]?.lastName).toBe("");
});
test("selects an owned library photo and submits complete identity", async () => {
  const view = await setup();
  await choose(view.getByRole("combobox", { name: "คำนำหน้า" }), "นาย");
  for (const [label, value] of [
    ["ชื่อ", "สมชาย"],
    ["นามสกุล", "ใจดี"],
    ["ชื่อเล่น", "ชาย"],
    ["เบอร์โทรศัพท์", "0812345678"],
  ] as const)
    fireEvent.change(view.getByLabelText(label), { target: { value } });
  fireEvent.click(view.getByRole("button", { name: "เลือกรูปภาพ" }));
  fireEvent.click(await screen.findByRole("button", { name: "face.png" }));
  fireEvent.click(screen.getByRole("button", { name: "ใช้รูปนี้" }));
  await waitFor(() =>
    expect(view.getByRole("button", { name: "ยืนยันลงทะเบียนผู้เข้าร่วม" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(view.getByRole("button", { name: "ยืนยันลงทะเบียนผู้เข้าร่วม" }));
  await waitFor(() => expect(view.submits).toHaveLength(1));
  expect(view.submits[0]?.institution).toBe("kmitl");
  expect(view.submits[0]?.photoFileId).toBe("4bca8f6e-5565-4d57-a216-a6dde11ca2e4");
});

test("background data changes cannot silently adopt another tab's revision", async () => {
  const view = await setup();
  fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "First" } });
  await waitFor(() => expect(view.saves).toHaveLength(1), { timeout: 1500 });
  view.data.revision = 99;
  fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "Next" } });
  await waitFor(() => expect(view.saves).toHaveLength(2), { timeout: 1500 });
  expect(view.revisions).toEqual([0, 1]);
});

test("a revoked session does not block navigation away from a medical draft", async () => {
  const view = await setup(null, {
    saveDraft: async () => {
      throw new ApiError(401, "Unauthorized");
    },
  });
  fireEvent.change(view.getByLabelText("โรคประจำตัว"), { target: { value: "Medical draft" } });
  await act(async () => {
    await view.router.navigate({ to: "/login" });
  });
  expect(view.router.state.location.pathname).toBe("/login");
  expect(view.queryByDisplayValue("Medical draft")).toBeNull();
});

for (const next of ["other", null] as const) {
  test(`${next ? "switching accounts" : "signing out in another tab"} removes medical state and cancels pending autosaves`, async () => {
    let identity: string | null = "guest";
    const now = new Date();
    const client = createAuthClient({
      baseURL: "http://localhost:3000",
      fetchOptions: {
        customFetchImpl: async () =>
          Response.json(
            identity
              ? {
                  user: {
                    id: identity,
                    name: identity,
                    email: `${identity}@example.com`,
                    emailVerified: true,
                    createdAt: now,
                    updatedAt: now,
                  },
                  session: {
                    id: identity,
                    token: identity,
                    userId: identity,
                    createdAt: now,
                    updatedAt: now,
                    expiresAt: new Date(Date.now() + 60000),
                  },
                }
              : null,
          ),
      },
    });
    const view = await setup(
      { ...EMPTY_PROFILE, medicalConditions: "Private diagnosis" },
      {},
      client,
    );
    await view.findByRole("button", { name: "guest" });
    view.query.setQueryData(["private-medical-data"], "Private diagnosis");
    fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "Pending edit" } });
    identity = next;
    await act(async () => {
      client.$store.notify("$sessionSignal");
    });
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/login"));
    expect(view.queryByDisplayValue("Private diagnosis")).toBeNull();
    expect(view.query.getQueryData(["private-medical-data"])).toBeUndefined();
    await act(async () => {
      await Bun.sleep(800);
    });
    expect(view.saves).toEqual([]);
  });
}

test("an account-mismatch response clears the form even before session refresh", async () => {
  const now = new Date();
  const client = createAuthClient({
    baseURL: "http://localhost:3000",
    fetchOptions: {
      customFetchImpl: async () =>
        Response.json({
          user: {
            id: "guest",
            name: "guest",
            email: "guest@example.com",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
          session: {
            id: "session",
            token: "token",
            userId: "guest",
            createdAt: now,
            updatedAt: now,
            expiresAt: new Date(Date.now() + 60000),
          },
        }),
    },
  });
  const view = await setup(
    { ...EMPTY_PROFILE, medicalConditions: "Private diagnosis" },
    {
      saveDraft: async () => {
        throw new ApiError(403, "Account changed", { code: "ACCOUNT_CHANGED" });
      },
    },
    client,
  );
  await view.findByRole("button", { name: "guest" });
  view.query.setQueryData(["private-medical-data"], "Private diagnosis");
  fireEvent.change(view.getByLabelText("ชื่อ"), { target: { value: "Pending edit" } });
  await act(async () => {
    void view.router.navigate({ to: "/" });
  });
  await waitFor(() => expect(view.queryByDisplayValue("Private diagnosis")).toBeNull());
  expect(view.query.getQueryData(["private-medical-data"])).toBeUndefined();
});

for (const failedSave of [false, true]) {
  test(`sign-out clears medical data after ${failedSave ? "a failed save" : "flushing the draft"}`, async () => {
    const now = new Date();
    const sessionData = {
      user: {
        id: "guest",
        name: "Student",
        email: "student@kmitl.ac.th",
        emailVerified: true,
        role: "guest",
        createdAt: now,
        updatedAt: now,
      },
      session: {
        id: "session",
        token: "test-token",
        userId: "guest",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(Date.now() + 60_000),
      },
    };
    const events: string[] = [];
    let signedOut = false;
    const client = createAuthClient({
      baseURL: "http://localhost:3000",
      fetchOptions: {
        customFetchImpl: async (input) => {
          const url = input instanceof Request ? input.url : String(input);
          if (url.endsWith("/get-session")) return Response.json(signedOut ? null : sessionData);
          if (!url.endsWith("/sign-out")) throw new Error(`Unexpected request ${url}`);
          events.push("revoke");
          signedOut = true;
          return Response.json({ success: true });
        },
      },
    });
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    const view = await setup(
      null,
      {
        saveDraft: async (revision) => {
          events.push("save");
          await saving;
          if (failedSave) throw new Error("offline");
          return { revision: revision + 1 };
        },
      },
      client,
    );
    view.query.setQueryData(["private-medical-data"], "Medical draft");
    fireEvent.change(view.getByLabelText("โรคประจำตัว"), { target: { value: "Medical draft" } });
    fireEvent.click(await view.findByRole("button", { name: "Student" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "ออกจากระบบ" }));
    await waitFor(() => expect(events).toEqual(["save"]));
    release();
    await waitFor(() => expect(events).toEqual(["save", "revoke"]));
    await waitFor(() => expect(view.queryByDisplayValue("Medical draft")).toBeNull());
    expect(view.query.getQueryData(["private-medical-data"])).toBeUndefined();
  });
}
