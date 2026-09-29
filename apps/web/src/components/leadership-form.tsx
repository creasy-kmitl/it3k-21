import { Button } from "@it3k/ui/components/button";
import { Checkbox } from "@it3k/ui/components/checkbox";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@it3k/ui/components/combobox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Spinner } from "@it3k/ui/components/spinner";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Unlink } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  type AttachableUser,
  type LeadershipApi,
  type LeadershipContact,
  type LeadershipSummary,
  type LeadershipUpdate,
  leadershipApi,
} from "@/lib/leadership";

import { DepartmentLabel } from "./department-icon";
import { ROLE_LABELS } from "./leadership-list";

export type FormMode =
  | { kind: "create" }
  /** `selfOnly`: a leader outside the manager departments editing their own seat. */
  | { kind: "edit"; seat: LeadershipSummary; selfOnly: boolean };

type Platform = LeadershipContact["socials"][number]["platform"];
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "line", label: "LINE" },
  { value: "discord", label: "Discord" },
  { value: "other", label: "อื่น ๆ" },
];
const ROLES = ["head", "vicehead"] as const;
type Role = (typeof ROLES)[number];
const ROLE_ITEMS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

// Mirrors the server's rules so mistakes show up before a round trip; the
// server still validates everything.
const socialSchema = z.object({
  platform: z.enum(["facebook", "instagram", "line", "discord", "other"]),
  value: z
    .string()
    .trim()
    .min(1, "กรุณาใส่ช่องทาง")
    .max(200, "ยาวเกิน 200 ตัวอักษร")
    .refine((value) => {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "ลิงก์ต้องขึ้นต้นด้วย https://"),
});

const formSchema = z.object({
  departmentId: z.string().min(1, "กรุณาเลือกฝ่าย"),
  role: z.enum(ROLES),
  name: z.string().trim().min(1, "กรุณาใส่ชื่อ").max(100, "ยาวเกิน 100 ตัวอักษร"),
  nickname: z.string().trim().max(40, "ยาวเกิน 40 ตัวอักษร"),
  account: z.object({ id: z.string(), name: z.string() }).nullable(),
  replaceContact: z.boolean(),
  phone: z
    .string()
    .trim()
    .max(30, "ยาวเกิน 30 ตัวอักษร")
    .regex(/^[0-9+\-() ]*$/, "ใช้ได้เฉพาะตัวเลข + - ( ) และเว้นวรรค"),
  socials: z
    .array(socialSchema)
    .max(PLATFORMS.length)
    .refine(
      (items) => new Set(items.map((item) => item.platform)).size === items.length,
      "แต่ละแพลตฟอร์มใส่ได้ครั้งเดียว",
    ),
});

type FormValues = z.input<typeof formSchema>;

function defaults(mode: FormMode): FormValues {
  const seat = mode.kind === "edit" ? mode.seat : null;
  return {
    departmentId: seat?.departmentId ?? "",
    role: seat?.role ?? "head",
    name: seat?.name ?? "",
    nickname: seat?.nickname ?? "",
    account: seat?.userId ? { id: seat.userId, name: seat.name } : null,
    // New seats set contact details directly; edits replace them only on request,
    // because the form never loads the current (audited) contact details.
    replaceContact: mode.kind === "create",
    phone: "",
    socials: [],
  };
}

const blankToNull = (value: string) => value.trim() || null;

function contactPayload(values: FormValues) {
  return {
    phone: blankToNull(values.phone),
    socials: values.socials.map((s) => ({ platform: s.platform, value: s.value.trim() })),
  };
}

function updatePayload(values: FormValues, selfOnly: boolean): LeadershipUpdate {
  const contact = values.replaceContact ? contactPayload(values) : {};
  if (selfOnly) {
    return { nickname: blankToNull(values.nickname), ...contact };
  }
  return {
    departmentId: values.departmentId,
    role: values.role,
    name: values.name.trim(),
    nickname: blankToNull(values.nickname),
    userId: values.account?.id ?? null,
    ...contact,
  };
}

type Props = {
  mode: FormMode;
  api?: LeadershipApi;
  onDone?: () => void;
  onCancel?: () => void;
};

export default function LeadershipForm({ mode, api = leadershipApi, onDone, onCancel }: Props) {
  const queryClient = useQueryClient();
  const selfOnly = mode.kind === "edit" && mode.selfOnly;
  const [formError, setFormError] = useState<string>();

  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => api.departments(),
    staleTime: 5 * 60_000,
  });

  const departmentItems =
    departments.data?.map((d) => ({ value: d.id, label: <DepartmentLabel department={d} /> })) ??
    [];

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      mode.kind === "create"
        ? api.create({
            departmentId: values.departmentId,
            role: values.role,
            name: values.name.trim(),
            nickname: blankToNull(values.nickname),
            userId: values.account?.id ?? null,
            ...contactPayload(values),
          })
        : api.update(mode.seat.id, updatePayload(values, selfOnly)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["leadership", "list"] });
      onDone?.();
    },
    onError: (error) => setFormError(error.message),
  });

  const form = useForm({
    defaultValues: defaults(mode),
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      setFormError(undefined);
      await save.mutateAsync(value).catch(() => {});
    },
  });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="departmentId">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <FieldLabel htmlFor="leadership-department">ฝ่าย</FieldLabel>
                <Select
                  items={departmentItems}
                  disabled={selfOnly}
                  value={field.state.value || null}
                  onValueChange={(value: string | null) => {
                    field.handleChange(value ?? "");
                    // An attached account must belong to the seat's department.
                    form.setFieldValue("account", null);
                  }}
                >
                  <SelectTrigger
                    id="leadership-department"
                    className="w-full"
                    onBlur={field.handleBlur}
                    aria-invalid={!field.state.meta.isValid}
                  >
                    <SelectValue placeholder="เลือกฝ่าย" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentItems.map((d) => (
                      <SelectItem key={d.value} value={d.value}>
                        {d.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="role">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="leadership-role">ตำแหน่ง</FieldLabel>
                <Select
                  items={ROLE_ITEMS}
                  disabled={selfOnly}
                  value={field.state.value}
                  onValueChange={(role: Role | null) => {
                    if (role) field.handleChange(role);
                  }}
                >
                  <SelectTrigger id="leadership-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_ITEMS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="name">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <FieldLabel htmlFor="leadership-name">ชื่อ</FieldLabel>
                <Input
                  id="leadership-name"
                  required
                  maxLength={100}
                  disabled={selfOnly}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                />
                <FieldDescription>ถ้าผูกบัญชีไว้ จะแสดงชื่อจากบัญชีแทน</FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="nickname">
            {(field) => (
              <Field data-invalid={!field.state.meta.isValid}>
                <FieldLabel htmlFor="leadership-nickname">ชื่อเล่น</FieldLabel>
                <Input
                  id="leadership-nickname"
                  maxLength={40}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={!field.state.meta.isValid}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        {!selfOnly && (
          <form.Field name="account">
            {(field) => (
              <AccountPicker
                api={api}
                value={field.state.value}
                onChange={(account) => field.handleChange(account)}
              />
            )}
          </form.Field>
        )}

        {mode.kind === "edit" && (
          <form.Field name="replaceContact">
            {(field) => (
              <Field orientation="horizontal">
                <Checkbox
                  id="leadership-replace-contact"
                  checked={field.state.value}
                  onCheckedChange={(checked) => field.handleChange(checked)}
                />
                <FieldLabel htmlFor="leadership-replace-contact">
                  เปลี่ยนเบอร์โทรและช่องทางติดต่อ
                </FieldLabel>
              </Field>
            )}
          </form.Field>
        )}

        <form.Subscribe selector={(state) => state.values.replaceContact}>
          {(replaceContact) =>
            replaceContact && (
              <FieldSet>
                <FieldLegend variant="label">ข้อมูลติดต่อ</FieldLegend>
                {mode.kind === "edit" && (
                  <FieldDescription>ข้อมูลเดิมทั้งหมดจะถูกแทนที่ด้วยข้อมูลนี้</FieldDescription>
                )}
                <form.Field name="phone">
                  {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                      <FieldLabel htmlFor="leadership-phone">เบอร์โทร</FieldLabel>
                      <Input
                        id="leadership-phone"
                        type="tel"
                        maxLength={30}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-invalid={!field.state.meta.isValid}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>

                <form.Field name="socials" mode="array">
                  {(socials) => (
                    <>
                      {socials.state.value.map((_, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <form.Field name={`socials[${i}].platform`}>
                            {(field) => (
                              <Select
                                items={PLATFORMS}
                                value={field.state.value}
                                onValueChange={(platform: Platform | null) => {
                                  if (platform) field.handleChange(platform);
                                }}
                              >
                                <SelectTrigger aria-label={`แพลตฟอร์ม ${i + 1}`} className="w-32">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {PLATFORMS.map((p) => (
                                    <SelectItem key={p.value} value={p.value}>
                                      {p.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </form.Field>
                          <form.Field name={`socials[${i}].value`}>
                            {(field) => (
                              <Field data-invalid={!field.state.meta.isValid} className="flex-1">
                                <Input
                                  aria-label={`ช่องทาง ${i + 1}`}
                                  placeholder="ชื่อบัญชี หรือลิงก์ https://"
                                  maxLength={200}
                                  value={field.state.value}
                                  onBlur={field.handleBlur}
                                  onChange={(e) => field.handleChange(e.target.value)}
                                  aria-invalid={!field.state.meta.isValid}
                                />
                                <FieldError errors={field.state.meta.errors} />
                              </Field>
                            )}
                          </form.Field>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`ลบช่องทาง ${i + 1}`}
                            onClick={() => socials.removeValue(i)}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      ))}
                      <FieldError errors={socials.state.meta.errors} />
                      {socials.state.value.length < PLATFORMS.length && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="self-start"
                          onClick={() => {
                            const used = new Set(socials.state.value.map((s) => s.platform));
                            const next = PLATFORMS.find((p) => !used.has(p.value)) ?? PLATFORMS[0]!;
                            socials.pushValue({ platform: next.value, value: "" });
                          }}
                        >
                          <Plus /> เพิ่มช่องทาง
                        </Button>
                      )}
                    </>
                  )}
                </form.Field>
              </FieldSet>
            )
          }
        </form.Subscribe>

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            บันทึกไม่สำเร็จ: {formError}
          </p>
        )}

        <div className="flex gap-2">
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner />}
                บันทึก
              </Button>
            )}
          </form.Subscribe>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>
              ยกเลิก
            </Button>
          )}
        </div>
      </FieldGroup>
    </form>
  );
}

function AccountPicker({
  api,
  value,
  onChange,
}: {
  api: LeadershipApi;
  value: AttachableUser | null;
  onChange: (account: AttachableUser | null) => void;
}) {
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim(), 300);

  const users = useQuery({
    queryKey: ["leadership", "users", { q }],
    queryFn: () => api.users({ q: q || undefined, page: 1 }),
    enabled: value === null,
  });

  if (value) {
    return (
      <Field>
        <FieldLabel>บัญชีผู้ใช้</FieldLabel>
        <div className="flex items-center gap-2">
          <span className="text-sm">{value.name}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null)}>
            <Unlink /> ถอดบัญชี
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor="leadership-account">บัญชีผู้ใช้</FieldLabel>
      <Combobox
        items={users.data?.items ?? []}
        filter={null}
        value={null}
        onValueChange={(account: AttachableUser | null) => {
          if (account) onChange(account);
        }}
        inputValue={search}
        onInputValueChange={setSearch}
        itemToStringLabel={(account: AttachableUser) => account.name}
        isItemEqualToValue={(a: AttachableUser, b: AttachableUser) => a.id === b.id}
      >
        <ComboboxInput
          id="leadership-account"
          aria-label="บัญชีผู้ใช้"
          placeholder="ค้นหาชื่อบัญชี"
          maxLength={64}
        />
        <ComboboxContent>
          <ComboboxEmpty>{users.isFetching ? "กำลังค้นหา…" : "ไม่พบบัญชีที่ยังไม่ผูก"}</ComboboxEmpty>
          <ComboboxList>
            {(account: AttachableUser) => (
              <ComboboxItem key={account.id} value={account}>
                {account.name}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <FieldDescription>ไม่บังคับ — เลือกบัญชีจากฝ่ายใดก็ได้</FieldDescription>
    </Field>
  );
}
