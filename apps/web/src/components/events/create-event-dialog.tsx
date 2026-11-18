import { type EventDraftInput, eventDraftInput, eventSlugBase } from "@it3k/db/event-rules";
import { slugify } from "@it3k/db/slugify";
import { ArrowRight, Plus, Type } from "lucide-react";
import { useState } from "react";

import { FormDialog, TextField, issuesOf } from "@/components/form-dialog";
import { SlugField } from "./slug-field";

/**
 * A new event from its name and link alone. Everything else (type, times,
 * content, tickets) is set on the event's edit tab, where this leads.
 */
export function CreateEventDialog({
  pending,
  error,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  /** A message from the API for the slug, such as "taken". */
  error?: string;
  onClose: () => void;
  onSubmit: (input: EventDraftInput) => void;
}) {
  const [name, setName] = useState("");
  // Follows the name until typed into.
  const [slug, setSlug] = useState("");
  const [slugTyped, setSlugTyped] = useState(false);
  const [issues, setIssues] = useState<Record<string, string>>({});
  // A draft starts as a general event, so a Thai name's fallback is
  // "general-<date>"; the API settles the exact date and any "-2".
  const shownSlug = slugTyped
    ? slug
    : eventSlugBase({ name, type: "general", startAt: Date.now() });

  return (
    <FormDialog
      title="เพิ่มกิจกรรม"
      icon={Plus}
      description="ตั้งชื่อกับลิงก์ก่อน แล้วไปกรอกรายละเอียด เวลา และตั๋วต่อในหน้าแก้ไข"
      submitLabel="สร้างแล้วแก้ไขต่อ"
      submitIcon={ArrowRight}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = eventDraftInput.safeParse({
          name,
          // "" has the API make it from the name, adding "-2" if it is taken.
          slug: slugTyped ? slugify(slug) : "",
        });
        if (!parsed.success) {
          setIssues(issuesOf(parsed.error));
          return;
        }
        setIssues({});
        onSubmit(parsed.data);
      }}
    >
      <TextField
        id="event-name"
        label="ชื่อกิจกรรม"
        icon={Type}
        value={name}
        onChange={setName}
        error={issues.name}
        autoFocus
        autoComplete="off"
      />
      <SlugField
        value={shownSlug}
        typed={slugTyped}
        error={issues.slug ?? error}
        onChange={(value) => {
          const next = slugify(value, { keepTrailingHyphen: true });
          setSlug(next);
          // Clearing the box hands it back to the name.
          setSlugTyped(next !== "");
        }}
        onReset={() => {
          setSlug("");
          setSlugTyped(false);
        }}
      />
    </FormDialog>
  );
}
