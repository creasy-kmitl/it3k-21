import { Badge } from "@it3k/ui/components/badge";
import { TAG_MAX_COUNT, TAG_MAX_LENGTH, normalizeTag } from "@it3k/db/short-link-rules";
import { Tag, X } from "lucide-react";
import { type KeyboardEvent, useId, useState } from "react";

/**
 * Tags as removable chips with a box to type more. Enter or a comma adds what
 * was typed; Backspace in the empty box removes the last. Tags already used
 * on other links are offered as suggestions.
 */
export function TagInput({
  id,
  value,
  onChange,
  suggestions = [],
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const full = value.length >= TAG_MAX_COUNT;

  function add(raw: string) {
    const tag = normalizeTag(raw.replace(/,/g, ""));
    setDraft("");
    if (!tag || value.includes(tag) || full) return;
    onChange([...value, tag]);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-4xl border border-input bg-input/30 px-3 py-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <Tag aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            type="button"
            aria-label={`เอาแท็ก ${tag} ออก`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => onChange(value.filter((other) => other !== tag))}
          >
            <X aria-hidden className="size-3" />
          </button>
        </Badge>
      ))}
      <input
        id={id}
        value={draft}
        list={listId}
        disabled={full}
        maxLength={TAG_MAX_LENGTH}
        placeholder={full ? `ครบ ${TAG_MAX_COUNT} แท็กแล้ว` : "พิมพ์แล้วกด Enter"}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        // A tag typed but not yet entered still counts when leaving the box.
        onBlur={() => draft.trim() && add(draft)}
      />
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !value.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}
