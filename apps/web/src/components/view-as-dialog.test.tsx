import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

import { ApiProvider } from "@/lib/api-context";
import type { ViewAsApi, ViewAsRequest } from "@/lib/view-as";
import { choose, fakeApi, fakeApis, renderWithQuery } from "@/test/query";

import { ViewAsDialog } from "./view-as-dialog";

afterEach(cleanup);

function setup() {
  const started: ViewAsRequest[] = [];
  const went: string[] = [];
  const api: ViewAsApi = {
    get: async () => ({ active: false }),
    start: async (json) => {
      started.push(json);
      return { active: true, kind: json.kind, department: null, institution: json.institution };
    },
    stop: async () => ({ active: false }),
  };
  const view = renderWithQuery(
    <ApiProvider value={fakeApis({ leadership: fakeApi() })}>
      <ViewAsDialog api={api} navigate={(path) => went.push(path)} onClose={() => {}} />
    </ApiProvider>,
  );
  return { view, started, went };
}

describe("ViewAsDialog", () => {
  test("views as staff of a department at an institution", async () => {
    const { view, started, went } = setup();
    const submit = view.getByRole("button", { name: "เริ่มจำลอง" });
    // Staff needs a department first.
    expect(submit).toHaveProperty("disabled", true);
    await choose(view.getByRole("combobox", { name: "ฝ่าย" }), "Tech/Live");
    await choose(view.getByRole("combobox", { name: "สถาบัน" }), "มจธ.");
    fireEvent.click(submit);
    await waitFor(() =>
      expect(started).toEqual([{ kind: "staff", departmentId: "d-tech", institution: "kmutt" }]),
    );
    expect(went).toEqual(["/staff/dashboard"]);
  });

  test("an athlete needs no department", async () => {
    const { view, started } = setup();
    await choose(view.getByRole("combobox", { name: "บทบาท" }), "นักกีฬา");
    expect(view.queryByRole("combobox", { name: "ฝ่าย" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "เริ่มจำลอง" }));
    await waitFor(() => expect(started).toEqual([{ kind: "athlete", institution: null }]));
  });
});
