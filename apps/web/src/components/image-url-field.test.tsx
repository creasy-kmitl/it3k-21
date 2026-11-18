import { afterEach, describe, expect, test } from "bun:test";
import { GiB } from "@it3k/db/profile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";

import { ApiProvider } from "@/lib/api-context";
import { publicFileUrl } from "@/lib/files";
import { fakeApis, fakeUsersApi } from "@/test/query";

import { ImageUrlField } from "./image-url-field";

afterEach(cleanup);

const file = (id: string, contentType: string) => ({
  id,
  name: `${id}.${contentType.split("/")[1]}`,
  size: 1,
  contentType,
  url: `https://files.test/${id}`,
  createdAt: new Date(0).toISOString(),
});

function setup(initial = "") {
  const apis = fakeApis({
    users: fakeUsersApi({ me: async () => ({ id: "u-me" }) as never }),
    files: {
      list: async () => ({
        items: [file("cover", "image/png"), file("brief", "application/pdf")],
        uploads: [],
        used: 2,
        limit: GiB,
        page: 1,
        hasMore: false,
      }),
      remove: async () => ({ success: true }),
      upload: async () => {
        throw new Error("Unexpected upload");
      },
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <>
        <ImageUrlField
          id="cover"
          label="รูปปก"
          value={value}
          onChange={setValue}
          selectTitle="เลือกรูปปก"
          fallback={<p>ภาพประกอบ</p>}
        />
        <output data-testid="value">{value}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <ApiProvider value={apis}>
        <Harness />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { value: () => screen.getByTestId("value").textContent };
}

describe("ImageUrlField", () => {
  test("picks a picture from the file library and previews it", async () => {
    const view = setup();
    expect(screen.getByText("ภาพประกอบ")).toBeTruthy();
    const pick = screen.getByRole("button", { name: "อัปโหลดหรือเลือกรูป" }) as HTMLButtonElement;
    await waitFor(() => expect(pick.disabled).toBe(false));
    fireEvent.click(pick);
    const library = await screen.findByRole("dialog", { name: "เลือกรูปปก" });
    fireEvent.click(await within(library).findByRole("button", { name: "cover.png" }));
    fireEvent.click(within(library).getByRole("button", { name: "ใช้รูปนี้" }));
    await waitFor(() => expect(view.value()).toBe(publicFileUrl("cover")));
    expect(screen.getByRole("img", { name: "ตัวอย่างรูปปก" }).getAttribute("src")).toBe(
      publicFileUrl("cover"),
    );
    expect(screen.queryByText("ภาพประกอบ")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "เอารูปออก" }));
    expect(view.value()).toBe("");
    expect(screen.getByText("ภาพประกอบ")).toBeTruthy();
  });

  test("a file that is not a picture is refused", async () => {
    const view = setup();
    const pick = screen.getByRole("button", { name: "อัปโหลดหรือเลือกรูป" }) as HTMLButtonElement;
    await waitFor(() => expect(pick.disabled).toBe(false));
    fireEvent.click(pick);
    const library = await screen.findByRole("dialog", { name: "เลือกรูปปก" });
    fireEvent.click(await within(library).findByRole("button", { name: "brief.pdf" }));
    fireEvent.click(within(library).getByRole("button", { name: "ใช้รูปนี้" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "เลือกรูปปก" })).toBeNull());
    expect(view.value()).toBe("");
  });

  test("a link can still be pasted, and a broken one falls back", async () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText("รูปปก"), {
      target: { value: "https://cdn.example/missing.png" },
    });
    expect(view.value()).toBe("https://cdn.example/missing.png");
    fireEvent.error(screen.getByRole("img", { name: "ตัวอย่างรูปปก" }));
    expect(screen.getByText("ภาพประกอบ")).toBeTruthy();
    expect(screen.getByRole("button", { name: "เปลี่ยนรูป" })).toBeTruthy();
  });
});
