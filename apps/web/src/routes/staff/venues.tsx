import { type VenueInput, venueInput } from "@it3k/db/event-rules";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@it3k/ui/components/field";
import { Skeleton } from "@it3k/ui/components/skeleton";
import { Textarea } from "@it3k/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink, MapPin, MapPinned, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDelete, FormDialog, TextField, issuesOf } from "@/components/form-dialog";
import { PageHeader } from "@/components/page-header";
import { useApis } from "@/lib/api-context";
import type { Venue } from "@/lib/venues";

export const Route = createFileRoute("/staff/venues")({
  component: VenuesPage,
});

/** A link to open the venue: its own link, else a map pin from its position. */
export function venueMapUrl(venue: Pick<Venue, "externalUrl" | "latitude" | "longitude">) {
  if (venue.externalUrl) return venue.externalUrl;
  if (venue.latitude === null || venue.longitude === null) return null;
  return `https://www.google.com/maps/search/?api=1&query=${venue.latitude},${venue.longitude}`;
}

type Editing = { kind: "venue"; venue: Venue | null } | { kind: "delete"; venue: Venue };

/** Places events happen. The API enforces who may edit. */
export function VenuesPage() {
  const { venues: api } = useApis();
  const queryClient = useQueryClient();
  const venues = useQuery({ queryKey: ["venues"], queryFn: () => api.list() });
  const [editing, setEditing] = useState<Editing | null>(null);
  const canManage = venues.data?.canManage ?? false;

  const save = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: () => {
      toast.success("บันทึกแล้ว");
      setEditing(null);
    },
    onError: (error) => toast.error(error.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["venues"] }),
  });

  return (
    <div className="flex flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader icon={MapPinned} title="สถานที่" description="สถานที่จัดกิจกรรมและการแข่งขัน" />
        {canManage && (
          <Button onClick={() => setEditing({ kind: "venue", venue: null })}>
            <Plus /> เพิ่มสถานที่
          </Button>
        )}
      </div>

      {venues.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">กำลังโหลด</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : venues.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-destructive">
          <p>โหลดสถานที่ไม่สำเร็จ: {venues.error.message}</p>
          <Button variant="outline" size="sm" onClick={() => void venues.refetch()}>
            ลองอีกครั้ง
          </Button>
        </div>
      ) : venues.data.items.length === 0 ? (
        <p className="text-muted-foreground">ยังไม่มีสถานที่</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-2xl border">
          {venues.data.items.map((venue) => {
            const mapUrl = venueMapUrl(venue);
            return (
              <li key={venue.id} className="flex items-center gap-3 px-4 py-3">
                <MapPin className="size-5 shrink-0 text-primary" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-medium">{venue.name}</span>
                  {venue.description && (
                    <span className="text-sm whitespace-pre-wrap text-muted-foreground">
                      {venue.description}
                    </span>
                  )}
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                    >
                      เปิดแผนที่ <ExternalLink className="size-3.5" aria-hidden />
                    </a>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`แก้ไข ${venue.name}`}
                      onClick={() => setEditing({ kind: "venue", venue })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`ลบ ${venue.name}`}
                      onClick={() => setEditing({ kind: "delete", venue })}
                    >
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editing?.kind === "venue" && (
        <VenueForm
          key={editing.venue?.id ?? "new"}
          initial={editing.venue}
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onSubmit={(input) => {
            const { venue } = editing;
            save.mutate(() => (venue ? api.update(venue.id, input) : api.create(input)));
          }}
        />
      )}
      {editing?.kind === "delete" && (
        <ConfirmDelete
          name={editing.venue.name}
          description="ลบได้เมื่อไม่มีกิจกรรมใช้สถานที่นี้"
          pending={save.isPending}
          onClose={() => setEditing(null)}
          onConfirm={() => save.mutate(() => api.remove(editing.venue.id))}
        />
      )}
    </div>
  );
}

/** Blank is no coordinate; anything else must read as a number. */
const coordinate = (text: string) => (text.trim() === "" ? null : Number(text));

function VenueForm({
  initial,
  pending,
  onClose,
  onSubmit,
}: {
  initial: Venue | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (input: VenueInput) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [latitude, setLatitude] = useState(initial?.latitude?.toString() ?? "");
  const [longitude, setLongitude] = useState(initial?.longitude?.toString() ?? "");
  const [externalUrl, setExternalUrl] = useState(initial?.externalUrl ?? "");
  const [issues, setIssues] = useState<Record<string, string>>({});

  return (
    <FormDialog
      title={initial ? `แก้ไข ${initial.name}` : "เพิ่มสถานที่"}
      pending={pending}
      onClose={onClose}
      onSubmit={() => {
        const parsed = venueInput.safeParse({
          name,
          description,
          latitude: coordinate(latitude),
          longitude: coordinate(longitude),
          externalUrl,
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
        id="venue-name"
        label="ชื่อสถานที่"
        value={name}
        onChange={setName}
        error={issues.name}
      />
      <Field data-invalid={!!issues.description}>
        <FieldLabel htmlFor="venue-description">รายละเอียด</FieldLabel>
        <Textarea
          id="venue-description"
          value={description}
          aria-invalid={!!issues.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {issues.description && <FieldDescription>{issues.description}</FieldDescription>}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id="venue-latitude"
          label="ละติจูด"
          inputMode="decimal"
          placeholder="13.7299"
          value={latitude}
          onChange={setLatitude}
          error={issues.latitude}
        />
        <TextField
          id="venue-longitude"
          label="ลองจิจูด"
          inputMode="decimal"
          placeholder="100.7782"
          value={longitude}
          onChange={setLongitude}
          error={issues.longitude}
        />
      </div>
      <TextField
        id="venue-url"
        label="ลิงก์แผนที่"
        inputMode="url"
        placeholder="https://maps.app.goo.gl/..."
        value={externalUrl}
        onChange={setExternalUrl}
        error={issues.externalUrl}
        hint="ไม่ใส่ก็ได้ ถ้ามีพิกัด ระบบจะลิงก์ไป Google Maps ให้"
      />
    </FormDialog>
  );
}
