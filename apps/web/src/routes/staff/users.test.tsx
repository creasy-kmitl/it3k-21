import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import type { Invitation, NewInvitation } from "@/lib/invitations";
import type { Account, Assignment, UsersApi } from "@/lib/users";
import {
  choose,
  defined,
  fakeApi,
  fakeInvitationsApi,
  page,
  renderRoute,
  summary,
} from "@/test/query";

import { UsersPage } from "./users";
import { ApiError } from "@/lib/leadership";

afterEach(cleanup);

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: crypto.randomUUID(),
    email: "friend@gmail.com",
    kind: "guest",
    department: null,
    institution: null,
    invitedBy: "Tech Head",
    createdAt: Date.UTC(2026, 10, 18),
    expiresAt: Date.UTC(2026, 11, 2),
    status: "pending",
    canManage: true,
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    storageLimit: 1073741824,
    storageUsed: 0,
    id: crypto.randomUUID(),
    name: "Someone",
    image: null,
    role: "staff",
    department: null,
    seatRole: null,
    canEdit: true,
    institution: null,
    canSetInstitution: false,
    canSetStorage: true,
    canImpersonate: false,
    ...overrides,
  };
}

const ALL_KINDS: Assignment["kind"][] = [
  "guest",
  "participant",
  "athlete",
  "staff",
  "head",
  "vicehead",
];

const unexpected = (name: string) => () => Promise.reject(new Error(`Unexpected call to ${name}`));

function setup(
  items: Account[],
  canGrantAdmin = false,
  overrides: Partial<UsersApi> = {},
  onImpersonate?: (userId: string) => Promise<void>,
  assignableKinds: Assignment["kind"][] = ALL_KINDS,
  invitations: Invitation[] = [],
  canSetInstitution = false,
) {
  const assigned: [string, Assignment][] = [];
  const invited: NewInvitation[] = [];
  const api: UsersApi = {
    setStorage: async () => {
      throw new Error("Unexpected quota update");
    },
    setInstitution: unexpected("setInstitution"),
    me: async () => ({
      id: "me",
      role: "staff",
      department: null,
      seatRole: null,
      canManageUsers: true,
      canManageDepartments: false,
      assignableKinds,
      institution: null,
      sportAccess: { permissions: [], scope: { kind: "none" } },
      canSendEmail: false,
      viewingAs: false,
    }),
    list: async () => ({ items, page: 1, hasMore: false, canGrantAdmin, assignableKinds }),
    assign: async (id, json) => {
      assigned.push([id, json]);
      return defined(items[0], "account");
    },
    setAdmin: unexpected("setAdmin"),
    ...overrides,
  };
  const seats = fakeApi({
    list: async () =>
      page([summary({ role: "head", userId: "u-old", displayName: "Old Head", name: "Old Head" })]),
  });
  const invitationsApi = fakeInvitationsApi({
    list: async () => ({ items: invitations, assignableKinds, canSetInstitution }),
    create: async (json) => {
      invited.push(json);
      return invitation({ email: json.email, kind: json.kind });
    },
  });
  return {
    assigned,
    invited,
    view: renderRoute(
      { options: { component: () => <UsersPage onImpersonate={onImpersonate} /> } },
      { users: api, leadership: seats, invitations: invitationsApi },
    ),
  };
}

describe("/staff/users", () => {
  test("shows each account's standing and only offers allowed edits", async () => {
    const { view } = setup([
      account({ name: "Guest One", role: "guest" }),
      account({ name: "Boss", role: "admin", canEdit: false }),
    ]);
    expect(await view.findByText("Guest One")).toBeTruthy();
    expect(view.getByRole("button", { name: "แก้ไข Boss" })).toHaveProperty("disabled", true);
    expect(view.queryByRole("checkbox", { name: "Admin" })).toBeNull();
  });

  test("makes a guest head of a department, warning about the current holder", async () => {
    const guest = account({ id: "u-guest", name: "Guest One", role: "guest" });
    const { view, assigned } = setup([guest]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "หัวหน้าฝ่าย");
    await choose(view.getByRole("combobox", { name: "ฝ่าย" }), "Art");
    expect(await view.findByText(/จะแทนที่ Old Head/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(assigned).toEqual([["u-guest", { kind: "head", departmentId: "d-art" }]]),
    );
  });
  test("a staff account without a department can be made a guest", async () => {
    const stray = account({ id: "u-stray", name: "Stray Staff", role: "staff" });
    const { view, assigned } = setup([stray]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Stray Staff" }));
    // It opens as Staff, not as the Guest it is not.
    expect(view.getByRole("combobox", { name: "สถานะ" }).textContent).toContain("Staff");
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "Guest");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(assigned).toEqual([["u-stray", { kind: "guest" }]]));
  });

  test("offers the storage quota only where the API allows it", async () => {
    const stray = account({ id: "u-stray", name: "Stray Staff", canSetStorage: false });
    const { view, assigned } = setup([stray]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Stray Staff" }));
    expect(view.queryByLabelText("พื้นที่จัดเก็บสูงสุด (GB)")).toBeNull();
    // setStorage throws if called: the quota is left alone.
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "Guest");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(assigned).toEqual([["u-stray", { kind: "guest" }]]));
  });

  test("sets an account's institution when allowed, and only then offers it", async () => {
    // A guest needs no department, so the dialog can save without one.
    const staff = account({
      id: "u-reg",
      name: "Reg Staff",
      role: "guest",
      canSetInstitution: true,
    });
    const set: [string, string | null][] = [];
    const { view } = setup([staff, account({ name: "Other" })], false, {
      setInstitution: async (id, institution) => {
        set.push([id, institution]);
        return { ...staff, institution };
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Other" }));
    expect(view.queryByRole("combobox", { name: "สถาบัน" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(view.getByRole("button", { name: "แก้ไข Reg Staff" }));
    await choose(view.getByRole("combobox", { name: "สถาบัน" }), "มจธ.");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(set).toEqual([["u-reg", "kmutt"]]));
  });

  test("saving an unchanged guest sends nothing", async () => {
    const guest = account({ id: "u-guest", name: "Guest One", role: "guest" });
    const { view, assigned } = setup([guest]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(assigned).toEqual([]);
  });

  test("retries an assignment after the quota update already succeeded", async () => {
    const guest = account({ name: "Guest One", role: "guest" });
    let persisted = guest;
    const expectedLimits: number[] = [];
    let assignments = 0;
    const { view } = setup([guest], false, {
      list: async () => ({
        items: [persisted],
        page: 1,
        hasMore: false,
        canGrantAdmin: false,
        assignableKinds: ALL_KINDS,
      }),
      setStorage: async (_id, storageLimit, expectedLimit) => {
        expectedLimits.push(expectedLimit);
        if (expectedLimit !== persisted.storageLimit) throw new ApiError(409, "stale quota");
        persisted = { ...persisted, storageLimit };
        return persisted;
      },
      assign: async () => {
        assignments++;
        if (assignments === 1) throw new Error("temporary assignment failure");
        persisted = { ...persisted, role: "athlete" };
        return persisted;
      },
    });
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Guest One" }));
    fireEvent.change(view.getByLabelText("พื้นที่จัดเก็บสูงสุด (GB)"), { target: { value: "2" } });
    await choose(view.getByRole("combobox", { name: "สถานะ" }), "นักกีฬา");
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(assignments).toBe(1));
    await waitFor(() =>
      expect(view.getByRole("button", { name: "บันทึก" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(assignments).toBe(2);
    expect(expectedLimits).toEqual([guest.storageLimit]);
    expect(persisted.role).toBe("athlete");
    expect(persisted.storageLimit).toBe(2 * 1024 ** 3);
  });

  test("offers to act as an account only where the API allows it, after confirming", async () => {
    const acted: string[] = [];
    const { view } = setup(
      [
        account({ id: "u-staff", name: "Plain Staff", canImpersonate: true }),
        account({ id: "u-admin", name: "Other Admin", role: "admin" }),
      ],
      true,
      {},
      async (id) => {
        acted.push(id);
      },
    );
    await view.findByText("Plain Staff");
    expect(view.queryByRole("button", { name: "ดูในฐานะ Other Admin" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "ดูในฐานะ Plain Staff" }));
    const dialog = await view.findByRole("alertdialog");
    expect(dialog.textContent).toContain("1 ชั่วโมง");
    expect(acted).toEqual([]);
    fireEvent.click(view.getByRole("button", { name: "ดูในฐานะผู้ใช้นี้" }));
    await waitFor(() => expect(acted).toEqual(["u-staff"]));
  });

  test("guest-only staff are offered guest, plus the account's current status", async () => {
    const athlete = account({ name: "Runner", role: "athlete" });
    const { view } = setup([athlete], false, {}, undefined, ["guest"]);
    fireEvent.click(await view.findByRole("button", { name: "แก้ไข Runner" }));
    fireEvent.click(view.getByRole("combobox", { name: "สถานะ" }));
    const options = (await view.findAllByRole("option")).map((o) => o.textContent);
    expect(options).toEqual(["Guest", "นักกีฬา"]);
  });
});

async function openInviteDialog(view: ReturnType<typeof setup>["view"]) {
  const button = await view.findByRole("button", { name: "เชิญผู้ใช้" });
  // Enabled once the list says which kinds the caller may give.
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  fireEvent.click(button);
  await view.findByRole("dialog");
}

describe("invitations", () => {
  test("lists invitations and offers resend and revoke only where allowed", async () => {
    const { view } = setup(
      [],
      false,
      {},
      undefined,
      ["guest"],
      [
        invitation({ email: "mine@gmail.com" }),
        invitation({ email: "theirs@gmail.com", kind: "staff", canManage: false }),
      ],
    );
    await view.findByText("mine@gmail.com");
    expect(view.getByRole("button", { name: "ยกเลิกคำเชิญของ mine@gmail.com" })).toBeDefined();
    expect(view.queryByRole("button", { name: "ยกเลิกคำเชิญของ theirs@gmail.com" })).toBeNull();
  });

  test("invites with only the kinds the caller may give", async () => {
    const { view, invited } = setup([], false, {}, undefined, ["guest"]);
    await openInviteDialog(view);
    fireEvent.click(view.getByRole("combobox", { name: "บทบาท" }));
    const options = await view.findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["Guest"]);
    const guest = defined(options[0]);
    fireEvent.pointerDown(guest, { pointerType: "mouse" });
    fireEvent.click(guest);
    fireEvent.change(view.getByLabelText("อีเมล"), { target: { value: "friend@gmail.com" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(invited).toEqual([{ email: "friend@gmail.com", kind: "guest", departmentId: null }]),
    );
    // Without the right to set an institution, the field is not offered.
    expect(view.queryByRole("combobox", { name: "สถาบัน" })).toBeNull();
  });

  test("sets the institution, suggested from the address until picked", async () => {
    const { view, invited } = setup([], false, {}, undefined, ["guest"], [], true);
    await openInviteDialog(view);
    fireEvent.change(view.getByLabelText("อีเมล"), { target: { value: "a@kmitl.ac.th" } });
    expect(view.getByRole("combobox", { name: "สถาบัน" }).textContent).toContain("สจล.");
    await choose(view.getByRole("combobox", { name: "สถาบัน" }), "มจพ. กรุงเทพฯ");
    fireEvent.change(view.getByLabelText("อีเมล"), { target: { value: "a@kmutt.ac.th" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(invited).toEqual([
        {
          email: "a@kmutt.ac.th",
          kind: "guest",
          departmentId: null,
          institution: "kmutnb-bangkok",
        },
      ]),
    );
  });

  test("a staff invitation asks for the department", async () => {
    const { view, invited } = setup([], false, {}, undefined, ALL_KINDS);
    await openInviteDialog(view);
    await choose(view.getByRole("combobox", { name: "บทบาท" }), "Staff");
    await choose(view.getByRole("combobox", { name: "ฝ่าย" }), "Art");
    fireEvent.change(view.getByLabelText("อีเมล"), { target: { value: "s@gmail.com" } });
    fireEvent.click(view.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(invited).toEqual([{ email: "s@gmail.com", kind: "staff", departmentId: "d-art" }]),
    );
  });
});
