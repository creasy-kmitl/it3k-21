import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { ApiError, type LeadershipContact } from "@/lib/leadership";
import { defined, fakeApi, summary } from "@/test/query";

import LeadershipContactButton from "./leadership-contact";

afterEach(cleanup);

const seat = summary({ displayName: "โอ๊ต Arthit" });
const WARNING = "การติดต่อฝ่ายอื่นควรติดต่อผ่าน Head เท่านั้น ยืนยันที่จะดูข้อมูลหรือไม่";

function setup(reveal: (id: string) => Promise<LeadershipContact>) {
  const calls: string[] = [];
  const api = fakeApi({
    reveal: (id) => {
      calls.push(id);
      return reveal(id);
    },
  });
  const view = render(<LeadershipContactButton seat={seat} api={api} />);
  const open = () => fireEvent.click(view.getByRole("button", { name: /ช่องทางติดต่อ/ }));
  return { calls, view, open };
}

const contact: LeadershipContact = {
  phone: "081-234-5678",
  socials: [
    { platform: "instagram", value: "https://instagram.com/oat" },
    { platform: "line", value: "oat.line" },
  ],
};

describe("LeadershipContactButton", () => {
  test("warns before asking the server", async () => {
    const { calls, view, open } = setup(async () => contact);
    open();
    const dialog = await view.findByRole("alertdialog");
    expect(dialog.textContent).toContain(WARNING);
    expect(calls).toEqual([]);
  });

  test("cancel sends nothing", async () => {
    const { calls, view, open } = setup(async () => contact);
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    expect(calls).toEqual([]);
  });

  test("confirm reveals once and shows the details", async () => {
    const { calls, view, open } = setup(async () => contact);
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    expect(await view.findByText("081-234-5678")).toBeTruthy();
    expect(calls).toEqual([seat.id]);
    const link = view.getByRole("link", { name: /instagram\.com\/oat/ });
    expect(link.getAttribute("href")).toBe("https://instagram.com/oat");
    expect(link.getAttribute("rel")).toContain("noopener");
    // Handles are text, not links.
    expect(view.getByText("oat.line").closest("a")).toBeNull();
  });

  test("closing clears the details; reopening warns again", async () => {
    const { calls, view, open } = setup(async () => contact);
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    await view.findByText("081-234-5678");
    fireEvent.click(view.getByRole("button", { name: "ปิด" }));
    await waitFor(() => expect(view.queryByText("081-234-5678")).toBeNull());
    open();
    expect((await view.findByRole("alertdialog")).textContent).toContain(WARNING);
    expect(view.queryByText("081-234-5678")).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test("a reveal that answers after the dialog closed is thrown away", async () => {
    let answer: (contact: LeadershipContact) => void = () => {};
    const { view, open } = setup(() => new Promise((resolve) => (answer = resolve)));
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    fireEvent.click(view.getByRole("button", { name: "ยกเลิก" }));
    await waitFor(() => expect(view.queryByRole("alertdialog")).toBeNull());
    await act(async () => answer(contact));
    expect(view.queryByText("081-234-5678")).toBeNull();
    open();
    expect((await view.findByRole("alertdialog")).textContent).toContain(WARNING);
    expect(view.queryByText("081-234-5678")).toBeNull();
  });

  test("a failed audit shows an error and no details", async () => {
    const { view, open } = setup(async () => {
      throw new ApiError(503, "Contact details are unavailable right now");
    });
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    expect((await view.findByRole("alert")).textContent).toContain("ดูข้อมูลติดต่อไม่ได้");
    expect(view.queryByText("081-234-5678")).toBeNull();
  });

  test("a seat without details says so", async () => {
    const { view, open } = setup(async () => ({ phone: null, socials: [] }));
    open();
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    expect(await view.findByText("ยังไม่มีข้อมูลติดต่อ")).toBeTruthy();
  });

  test("shows the department as a colored badge with its icon", async () => {
    const api = fakeApi({ reveal: async () => contact });
    const view = render(
      <LeadershipContactButton
        seat={seat}
        department={{ id: "d-art", name: "Art", icon: "palette", color: "rose" }}
        api={api}
      />,
    );
    fireEvent.click(view.getByRole("button", { name: /ช่องทางติดต่อ/ }));
    fireEvent.click(await view.findByRole("button", { name: "ยืนยัน" }));
    const badge = defined((await view.findByText("Art")).closest("[data-slot=badge]"), "badge");
    expect(badge.className).toContain("bg-rose-500/15");
    expect(badge.querySelector("svg.lucide-palette")).not.toBeNull();
  });
});
