import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagInput } from "./tag-input";

afterEach(cleanup);

function setup() {
  const onChange = mock((_tags: string[]) => {});
  render(
    <>
      <label htmlFor="tags">แท็ก</label>
      <TagInput id="tags" value={[]} onChange={onChange} />
    </>,
  );
  const input = screen.getByLabelText("แท็ก") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "งาน" } });
  return { input, onChange };
}

describe("TagInput", () => {
  test("Enter adds the typed tag", () => {
    const { input, onChange } = setup();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["งาน"]);
  });

  test("Enter that confirms an IME word adds nothing", () => {
    const { input, onChange } = setup();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  test("Safari's IME Enter (keyCode 229) adds nothing", () => {
    const { input, onChange } = setup();
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(onChange).not.toHaveBeenCalled();
  });
});
