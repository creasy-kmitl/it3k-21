import { describe, expect, test } from "bun:test";

import { answerShortLink } from "./short-link-proxy";

const scanned = (method = "GET") =>
  new Request("https://it3k.test/l/register?qr", { method, headers: { "accept-language": "th" } });

function unavailable(reason: string, status: number) {
  return async () =>
    new Response("ไม่พบลิงก์นี้", {
      status,
      headers: { "X-Short-Link-Unavailable": reason, "content-type": "text/plain" },
    });
}

describe("answerShortLink", () => {
  test("passes a redirect straight through", async () => {
    const redirect = Response.redirect("https://forms.example.com/", 302);
    const res = await answerShortLink(
      scanned(),
      async () => redirect,
      async () => {
        throw new Error("no page for a redirect");
      },
    );
    expect(res).toBe(redirect);
  });

  test("answers an unavailable link with the site's page and the API's status", async () => {
    const rendered: Request[] = [];
    const res = await answerShortLink(scanned(), unavailable("expired", 410), async (page) => {
      rendered.push(page);
      return new Response("<html>หมดอายุ</html>", { headers: { "content-type": "text/html" } });
    });
    expect(res.status).toBe(410);
    expect(await res.text()).toBe("<html>หมดอายุ</html>");
    expect(res.headers.get("content-type")).toBe("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    // Same address, so the browser hydrates the route it rendered.
    expect(rendered[0]?.url).toBe("https://it3k.test/l/register?qr");
    expect(rendered[0]?.headers.get("x-short-link-unavailable")).toBe("expired");
    expect(rendered[0]?.headers.get("accept-language")).toBe("th");
  });

  test("ignores a reason it does not know", async () => {
    const api = unavailable("<script>", 404);
    const res = await answerShortLink(scanned(), api, async () => {
      throw new Error("must not render");
    });
    expect(await res.text()).toBe("ไม่พบลิงก์นี้");
  });

  test("falls back to the API's answer when the page fails", async () => {
    const res = await answerShortLink(
      scanned(),
      unavailable("missing", 404),
      async () => new Response("boom", { status: 500 }),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("ไม่พบลิงก์นี้");
  });

  test("HEAD gets the status without a body", async () => {
    const res = await answerShortLink(
      scanned("HEAD"),
      unavailable("disabled", 410),
      async () => new Response("<html></html>"),
    );
    expect(res.status).toBe(410);
    expect(await res.text()).toBe("");
  });

  test("an API that throws gets the error page with a 503, and is logged", async () => {
    const errors: unknown[] = [];
    const rendered: Request[] = [];
    const res = await answerShortLink(
      scanned(),
      async () => {
        throw new Error("service binding down");
      },
      async (page) => {
        rendered.push(page);
        return new Response("<html>ขัดข้อง</html>");
      },
      (error) => errors.push(error),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(await res.text()).toBe("<html>ขัดข้อง</html>");
    expect(rendered[0]?.headers.get("x-short-link-unavailable")).toBe("error");
    expect(errors).toHaveLength(1);
  });

  test("an API 5xx is treated the same way", async () => {
    const errors: unknown[] = [];
    const res = await answerShortLink(
      scanned(),
      async () => new Response("D1 is down", { status: 500 }),
      async () => new Response("<html></html>"),
      (error) => errors.push(error),
    );
    expect(res.status).toBe(503);
    expect(errors).toHaveLength(1);
  });

  test("with the page down too, a plain 503 still explains", async () => {
    const res = await answerShortLink(
      scanned(),
      async () => {
        throw new Error("down");
      },
      async () => {
        throw new Error("also down");
      },
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain("ขัดข้องชั่วคราว");
  });

  test("a locked link's page learns why the last password failed, under the API's status", async () => {
    const rendered: Request[] = [];
    const res = await answerShortLink(
      scanned("POST"),
      async () =>
        new Response("limited", {
          status: 429,
          headers: { "X-Short-Link-Unavailable": "locked", "X-Short-Link-Unlock": "limited" },
        }),
      async (page) => {
        rendered.push(page);
        return new Response("<html>ล็อก</html>");
      },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(rendered[0]?.method).toBe("GET");
    expect(rendered[0]?.headers.get("x-short-link-unavailable")).toBe("locked");
    expect(rendered[0]?.headers.get("x-short-link-unlock")).toBe("limited");
  });

  test("a visitor cannot plant an unlock message themselves", async () => {
    const rendered: Request[] = [];
    const request = new Request("https://it3k.test/l/register", {
      headers: { "X-Short-Link-Unlock": "wrong" },
    });
    await answerShortLink(request, unavailable("locked", 403), async (page) => {
      rendered.push(page);
      return new Response("<html></html>");
    });
    expect(rendered[0]?.headers.get("x-short-link-unlock")).toBeNull();
  });
});
