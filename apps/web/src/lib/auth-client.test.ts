import { describe, expect, test } from "bun:test";

import { withViewAs } from "./auth-client";
import { type ViewAsState, viewedUser } from "./view-as";

const TECH = { id: "d-tech", name: "Tech/Live", icon: "monitor-play", color: "indigo" } as const;

function session(role: string, impersonatedBy: string | null = null) {
  return {
    data: {
      user: { id: "u1", name: "U", role, departmentId: "d-art", institution: null },
      session: { id: "s1", impersonatedBy },
    },
  } as unknown as Parameters<typeof withViewAs>[0];
}

function loader(view: ViewAsState) {
  const calls: number[] = [];
  return {
    calls,
    load: async () => {
      calls.push(1);
      return view;
    },
  };
}

describe("viewedUser", () => {
  test("a seat views as staff of its department", () => {
    const user = viewedUser(
      { role: "admin", departmentId: "d-art" as string | null, institution: null as string | null },
      { active: true, kind: "vicehead", department: TECH, institution: "kmitl" },
    );
    expect(user).toEqual({ role: "staff", departmentId: "d-tech", institution: "kmitl" });
  });
});

describe("withViewAs", () => {
  test("hands an admin's session the view's role, department and institution", async () => {
    const { load } = loader({
      active: true,
      kind: "guest",
      department: null,
      institution: "kmutt",
    });
    const result = await withViewAs(session("admin"), load);
    expect(result.data?.user).toMatchObject({
      role: "guest",
      departmentId: null,
      institution: "kmutt",
    });
  });

  test("leaves an admin with no view as they are", async () => {
    const { load } = loader({ active: false });
    const result = await withViewAs(session("admin"), load);
    expect(result.data?.user.role).toBe("admin");
  });

  test("never asks about a view for non-admins or impersonated sessions", async () => {
    for (const s of [session("staff"), session("admin", "admin-2"), { data: null } as never]) {
      const { calls, load } = loader({
        active: true,
        kind: "guest",
        department: null,
        institution: null,
      });
      expect(await withViewAs(s, load)).toBe(s);
      expect(calls).toEqual([]);
    }
  });
});
