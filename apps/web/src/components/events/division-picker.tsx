import { Checkbox } from "@it3k/ui/components/checkbox";
import { FieldError, FieldLabel, FieldSet, Field } from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Medal } from "lucide-react";

import { FormLegend } from "@/components/form-dialog";
import { SportThumbnail } from "@/components/sport-art";
import { DivisionTags } from "@/components/sport-badges";
import type { Sport } from "@/lib/sports";

/** Divisions grouped by sport; a sport's own box picks or drops all of them. */
export function DivisionPicker({
  sports,
  loading,
  value,
  onChange,
  error,
}: {
  sports: Sport[];
  loading: boolean;
  value: string[];
  onChange: (value: string[]) => void;
  error?: string;
}) {
  const picked = new Set(value);
  return (
    <FieldSet data-invalid={!!error}>
      <FormLegend icon={Medal}>ประเภทกีฬา</FormLegend>
      {loading && <Skeleton className="h-24" />}
      <div className="flex flex-col gap-3">
        {sports
          .filter((sport) => sport.divisions.length > 0)
          .map((sport) => {
            const ids = sport.divisions.map((division) => division.id);
            const count = ids.filter((id) => picked.has(id)).length;
            return (
              <div key={sport.id} className="flex flex-col gap-2 rounded-xl border p-3">
                <Field orientation="horizontal">
                  <Checkbox
                    id={`event-sport-${sport.id}`}
                    checked={count === ids.length}
                    indeterminate={count > 0 && count < ids.length}
                    onCheckedChange={(checked) =>
                      onChange(
                        checked
                          ? [...value, ...ids.filter((id) => !picked.has(id))]
                          : value.filter((id) => !ids.includes(id)),
                      )
                    }
                  />
                  <FieldLabel
                    htmlFor={`event-sport-${sport.id}`}
                    className="min-w-0 flex-1 items-center gap-2 font-medium"
                  >
                    <span aria-hidden className="shrink-0">
                      <SportThumbnail
                        src={sport.thumbnailUrl}
                        icon={sport.icon}
                        seed={sport.id}
                        label={sport.name}
                        className="aspect-square size-8 w-8 rounded-lg"
                      />
                    </span>
                    <span className="truncate">{sport.name}</span>
                  </FieldLabel>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {count}/{ids.length}
                  </span>
                </Field>
                <div className="flex flex-col gap-2 pl-6">
                  {sport.divisions.map((division) => (
                    <Field key={division.id} orientation="horizontal">
                      <Checkbox
                        id={`event-division-${division.id}`}
                        checked={picked.has(division.id)}
                        onCheckedChange={(checked) =>
                          onChange(
                            checked
                              ? [...value, division.id]
                              : value.filter((id) => id !== division.id),
                          )
                        }
                      />
                      <FieldLabel
                        htmlFor={`event-division-${division.id}`}
                        className="flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-normal"
                      >
                        <span>{division.name}</span>
                        <DivisionTags division={division} />
                      </FieldLabel>
                    </Field>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
      <FieldError>{error}</FieldError>
    </FieldSet>
  );
}
