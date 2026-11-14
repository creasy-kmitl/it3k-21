import { afterEach, describe, expect, test } from "bun:test";
import { SPORT_ICONS } from "@it3k/db/sport-rules";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { SportArt, SportThumbnail, seedHash } from "./sport-art";

afterEach(cleanup);

describe("sport art", () => {
  test("the same seed always draws the same background", () => {
    expect(seedHash("football")).toBe(seedHash("football"));
    expect(seedHash("football")).not.toBe(seedHash("badminton"));
    const first = render(<SportArt icon="football" seed="abc" label="a" />).container.innerHTML;
    cleanup();
    const again = render(<SportArt icon="football" seed="abc" label="a" />).container.innerHTML;
    // useId differs per render tree; compare without the generated ids.
    const strip = (html: string) => html.replace(/_r_[0-9a-z]+_|«[^»]*»|:r[0-9a-z]+:/g, "");
    expect(strip(again)).toBe(strip(first));
  });

  test("draws every icon", () => {
    for (const icon of SPORT_ICONS) {
      const view = render(<SportArt icon={icon} seed={icon} label={icon} />);
      expect(view.getByRole("img", { name: icon }).querySelector("g")?.childElementCount).toBeGreaterThan(0);
      cleanup();
    }
  });

  test("falls back to the illustration when the thumbnail fails to load", () => {
    const view = render(
      <SportThumbnail src="https://cdn.test/x.jpg" icon="esports" seed="x" label="ROV" />,
    );
    fireEvent.error(view.getByRole("img", { name: "ROV" }));
    expect(view.getByRole("img", { name: "ROV" }).tagName.toLowerCase()).toBe("svg");
  });
});
