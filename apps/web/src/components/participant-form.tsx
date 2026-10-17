import {
  EMPTY_PROFILE,
  INSTITUTIONS,
  PREFIXES,
  profileSchema,
  suggestedInstitution,
  type ProfileValues,
} from "@it3k/db/profile";
import { Alert, AlertDescription } from "@it3k/ui/components/alert";
import { Badge } from "@it3k/ui/components/badge";
import { Button } from "@it3k/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@it3k/ui/components/card";
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
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
} from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Spinner } from "@it3k/ui/components/spinner";
import { Textarea } from "@it3k/ui/components/textarea";
import { useForm } from "@tanstack/react-form";
import { useBlocker } from "@tanstack/react-router";
import {
  Camera,
  CircleAlert,
  CircleCheck,
  CloudAlert,
  CloudUpload,
  ContactRound,
  GraduationCap,
  HeartPulse,
  IdCard,
  ImagePlus,
  Phone,
  Pill,
  RefreshCw,
  Save,
  Smile,
  Stethoscope,
  UserRound,
  UtensilsCrossed,
  WheatOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApis } from "@/lib/api-context";
import { DraftSaver, type SaveState } from "@/lib/draft-saver";
import { publicFileUrl } from "@/lib/files";
import type { MyProfile } from "@/lib/profile";
import { isAccountChanged, isSignedOut } from "@/lib/leadership";
import { useSignOutGuard } from "@/lib/sign-out-guard";
import { FileLibrary } from "./file-library";
import { useEndSession } from "./session-boundary";

const PERSONAL = [
  { name: "firstName", label: "ชื่อ", complete: "given-name", icon: UserRound },
  { name: "lastName", label: "นามสกุล", complete: "family-name", icon: ContactRound },
  { name: "nickname", label: "ชื่อเล่น", complete: "nickname", icon: Smile },
  { name: "phone", label: "เบอร์โทรศัพท์", complete: "tel", icon: Phone },
] as const;
const HEALTH = [
  { name: "medicalConditions", label: "โรคประจำตัว", icon: Stethoscope },
  { name: "drugAllergies", label: "ประวัติการแพ้ยา", icon: Pill },
  { name: "foodAllergies", label: "อาหารที่แพ้", icon: WheatOff },
  { name: "dietaryRestrictions", label: "ข้อจำกัดด้านอาหาร", icon: UtensilsCrossed },
] as const;
const SAVE_LABELS: Record<SaveState, string> = {
  saved: "บันทึกร่างแล้ว",
  pending: "มีข้อมูลรอบันทึก",
  saving: "กำลังบันทึกร่าง…",
  error: "บันทึกร่างไม่สำเร็จ",
  conflict: "ข้อมูลเปลี่ยนแปลงจากหน้าอื่น",
};
const SAVE_ICONS = {
  saved: CircleCheck,
  pending: CloudUpload,
  saving: Spinner,
  error: CloudAlert,
  conflict: CircleAlert,
} as const;

function ParticipantFieldLabel({
  name,
  label,
  icon: Icon,
  required = false,
}: {
  name: keyof ProfileValues;
  label: string;
  icon: LucideIcon;
  required?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FieldLabel htmlFor={name} className="items-center [&_svg]:size-4 [&_svg]:shrink-0">
        <Icon className="text-muted-foreground" aria-hidden />
        {label}
      </FieldLabel>
      <Badge id={`${name}-requirement`} variant={required ? "secondary" : "outline"}>
        {required ? "จำเป็น" : "ไม่บังคับ"}
      </Badge>
    </div>
  );
}

export function ParticipantForm({
  data,
  onComplete,
}: {
  data: MyProfile;
  onComplete: () => Promise<void>;
}) {
  const { profile } = useApis();
  const signOutGuard = useSignOutGuard();
  const endSession = useEndSession();
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [photos, setPhotos] = useState(false);
  const SaveIcon = SAVE_ICONS[saveState];
  const saver = useRef<DraftSaver | null>(null);
  // A background query refetch must not adopt a newer tab's revision while
  // keeping this form's older values. Reload explicitly to resolve a conflict.
  const snapshot = useRef({
    revision: data.revision,
    accountId: data.account.id,
    api: profile,
  }).current;
  const [initial] = useState<ProfileValues>(
    () =>
      data.draft ??
      data.profile ?? {
        ...EMPTY_PROFILE,
        institution: suggestedInstitution(data.account.email),
      },
  );
  useEffect(() => {
    let mounted = true;
    const controller = new DraftSaver(
      snapshot.revision,
      async (revision, values) => {
        try {
          return await snapshot.api.saveDraft(revision, values, snapshot.accountId);
        } catch (error) {
          if (isSignedOut(error) || isAccountChanged(error)) endSession?.();
          throw error;
        }
      },
      (state, message) => {
        if (mounted) {
          setSaveState(state);
          setError(message ?? "");
        }
      },
    );
    saver.current = controller;
    const beforeSignOut = async () => {
      try {
        await controller.flush();
      } catch (error) {
        // An already expired session cannot save, but must still be cleared.
        if (!isSignedOut(error) && !isAccountChanged(error)) throw error;
      }
    };
    if (signOutGuard) signOutGuard.current = beforeSignOut;
    return () => {
      mounted = false;
      controller.stop();
      if (signOutGuard?.current === beforeSignOut) signOutGuard.current = null;
    };
  }, [endSession, signOutGuard, snapshot]);
  useBlocker({
    shouldBlockFn: async () => {
      try {
        await saver.current?.flush();
        return false;
      } catch (error) {
        return !isSignedOut(error) && !isAccountChanged(error);
      }
    },
    enableBeforeUnload: saveState !== "saved",
  });
  const form = useForm({
    defaultValues: initial,
    // Validate changes but reveal errors after blur/submit. A separate form-wide
    // onBlur error map would keep old photo errors after the dialog changes it.
    validators: { onChange: profileSchema, onSubmit: profileSchema },
    listeners: { onChange: ({ formApi }) => saver.current?.change(formApi.state.values) },
    onSubmit: async ({ value }) => {
      const parsed = profileSchema.safeParse(value);
      if (!parsed.success || !saver.current) return;
      setSubmitting(true);
      setError("");
      try {
        await saver.current.flush();
        const result = await profile.submit({
          userId: data.account.id,
          revision: saver.current.revision,
          values: parsed.data,
        });
        saver.current.revision = result.revision;
        await onComplete();
      } catch (err) {
        if (isSignedOut(err) || isAccountChanged(err)) endSession?.();
        setError(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
      } finally {
        setSubmitting(false);
      }
    },
  });
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <SaveIcon className="size-4 shrink-0" aria-hidden />
          {SAVE_LABELS[saveState]}
        </p>
        {saveState === "error" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => void saver.current?.flush().catch(() => undefined)}
          >
            <RefreshCw data-icon="inline-start" aria-hidden />
            ลองบันทึกอีกครั้ง
          </Button>
        )}
        {saveState === "conflict" && (
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>
            <RefreshCw data-icon="inline-start" aria-hidden />
            โหลดข้อมูลใหม่
          </Button>
        )}
      </div>
      {error && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[20rem_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
              <Camera className="text-primary" aria-hidden />
              รูปที่มั่นใจที่สุด
              <Badge id="photoFileId-requirement" variant="secondary">
                จำเป็น
              </Badge>
            </CardTitle>
            <CardDescription>รูปนี้จะแสดงบนโปรไฟล์ของคุณ</CardDescription>
          </CardHeader>
          <CardContent>
            <form.Field name="photoFileId">
              {(field) => {
                const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                return (
                  <Field data-invalid={invalid}>
                    {field.state.value ? (
                      <img
                        src={publicFileUrl(field.state.value)}
                        alt="รูปที่เลือกสำหรับโปรไฟล์"
                        className="aspect-square w-full rounded-2xl object-cover"
                      />
                    ) : (
                      <div className="flex aspect-square items-center justify-center rounded-2xl border border-dashed bg-muted">
                        <ImagePlus className="size-12 text-muted-foreground" aria-hidden />
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={submitting}
                      aria-invalid={invalid}
                      aria-describedby="photoFileId-requirement photoFileId-description"
                      onClick={() => {
                        field.handleBlur();
                        setPhotos(true);
                      }}
                    >
                      <ImagePlus data-icon="inline-start" aria-hidden />
                      {field.state.value ? "เปลี่ยนรูป" : "เลือกรูปภาพ"}
                    </Button>
                    <FieldDescription id="photoFileId-description">
                      ต้องเห็นใบหน้าชัดเจน ไม่สวมแมสก์ ไม่สวมแว่นตา
                      <br />
                      JPEG, PNG หรือ WebP ขนาดไม่เกิน 10 MB
                    </FieldDescription>
                    {invalid && <FieldError errors={field.state.meta.errors} />}
                    {photos && (
                      <FileLibrary
                        onClose={() => setPhotos(false)}
                        onSelect={(file) => {
                          field.handleChange(file.id);
                          setPhotos(false);
                        }}
                      />
                    )}
                  </Field>
                );
              }}
            </form.Field>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                <UserRound className="text-primary" aria-hidden />
                ข้อมูลส่วนตัว
              </CardTitle>
              <CardDescription>กรอกข้อมูลให้ครบก่อนยืนยันการลงทะเบียน</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <form.Field name="prefix">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    return (
                      <Field data-invalid={invalid}>
                        <ParticipantFieldLabel
                          name="prefix"
                          label="คำนำหน้า"
                          icon={IdCard}
                          required
                        />
                        <Select
                          items={PREFIXES.map((value) => ({ value, label: value }))}
                          value={field.state.value || null}
                          onValueChange={(value: (typeof PREFIXES)[number] | null) => {
                            field.handleChange(value ?? "");
                            field.handleBlur();
                          }}
                          disabled={submitting}
                        >
                          <SelectTrigger
                            id="prefix"
                            aria-invalid={invalid}
                            aria-required
                            aria-describedby="prefix-requirement"
                          >
                            <SelectValue placeholder="เลือกคำนำหน้า" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {PREFIXES.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        {invalid && <FieldError errors={field.state.meta.errors} />}
                      </Field>
                    );
                  }}
                </form.Field>
                <FieldGroup className="grid gap-4 sm:grid-cols-2">
                  {PERSONAL.map(({ name, label, complete, icon: Icon }) => (
                    <form.Field key={name} name={name}>
                      {(field) => {
                        const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                        return (
                          <Field data-invalid={invalid}>
                            <ParticipantFieldLabel name={name} label={label} icon={Icon} required />
                            <Input
                              id={name}
                              name={name}
                              type={name === "phone" ? "tel" : "text"}
                              autoComplete={complete}
                              maxLength={name === "phone" ? 32 : 100}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(event) => field.handleChange(event.target.value)}
                              aria-invalid={invalid}
                              aria-required
                              aria-describedby={`${name}-requirement`}
                              disabled={submitting}
                            />
                            {invalid && <FieldError errors={field.state.meta.errors} />}
                          </Field>
                        );
                      }}
                    </form.Field>
                  ))}
                </FieldGroup>
                <form.Field name="institution">
                  {(field) => {
                    const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                    const selected =
                      INSTITUTIONS.find((item) => item.id === field.state.value) ?? null;
                    return (
                      <Field data-invalid={invalid}>
                        <ParticipantFieldLabel
                          name="institution"
                          label="มหาวิทยาลัย/สถาบัน"
                          icon={GraduationCap}
                          required
                        />
                        <Combobox<(typeof INSTITUTIONS)[number]>
                          items={[...INSTITUTIONS]}
                          value={selected}
                          itemToStringLabel={(item) => item.name}
                          itemToStringValue={(item) => item.id}
                          onValueChange={(item) => {
                            field.handleChange(item?.id ?? "");
                            field.handleBlur();
                          }}
                          disabled={submitting}
                        >
                          <ComboboxInput
                            id="institution"
                            aria-invalid={invalid}
                            aria-required
                            aria-describedby="institution-requirement"
                            placeholder="ค้นหามหาวิทยาลัย/สถาบัน"
                            triggerLabel="เลือกมหาวิทยาลัย/สถาบัน"
                            clearLabel="ล้างสถาบัน"
                            onBlur={field.handleBlur}
                          />
                          {selected && (
                            <span className="mt-2 flex items-center gap-2 text-sm">
                              <img src={selected.logo} alt="" className="size-8 object-contain" />
                              {selected.short}
                            </span>
                          )}
                          <ComboboxContent>
                            <ComboboxEmpty>ไม่พบสถาบัน</ComboboxEmpty>
                            <ComboboxList>
                              <ComboboxGroup>
                                <ComboboxCollection>
                                  {(item: (typeof INSTITUTIONS)[number]) => (
                                    <ComboboxItem key={item.id} value={item}>
                                      <img
                                        src={item.logo}
                                        alt=""
                                        className="size-8 shrink-0 object-contain"
                                      />
                                      <span className="whitespace-normal">{item.name}</span>
                                    </ComboboxItem>
                                  )}
                                </ComboboxCollection>
                              </ComboboxGroup>
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                        <FieldDescription>
                          แนะนำจากอีเมล Google ของคุณ คุณเปลี่ยนสถาบันได้เสมอ · มจพ.
                          กรุณาเลือกวิทยาเขตด้วยตนเอง
                        </FieldDescription>
                        {invalid && <FieldError errors={field.state.meta.errors} />}
                      </Field>
                    );
                  }}
                </form.Field>
              </FieldGroup>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 [&_svg]:size-5 [&_svg]:shrink-0">
                <HeartPulse className="text-primary" aria-hidden />
                สุขภาพและอาหาร
              </CardTitle>
              <CardDescription>กรอกเมื่อมีข้อมูลที่ต้องแจ้ง เว้นว่างได้</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {HEALTH.map(({ name, label, icon: Icon }) => (
                  <form.Field key={name} name={name}>
                    {(field) => {
                      const invalid = field.state.meta.isTouched && !field.state.meta.isValid;
                      return (
                        <Field data-invalid={invalid}>
                          <ParticipantFieldLabel name={name} label={label} icon={Icon} />
                          <Textarea
                            id={name}
                            name={name}
                            rows={3}
                            maxLength={2000}
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                            aria-invalid={invalid}
                            aria-required={false}
                            aria-describedby={`${name}-requirement`}
                            disabled={submitting}
                            placeholder="ไม่มี / ระบุรายละเอียด"
                          />
                          {invalid && <FieldError errors={field.state.meta.errors} />}
                        </Field>
                      );
                    }}
                  </form.Field>
                ))}
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>
      <form.Subscribe
        selector={(state) => ({ submitting: state.isSubmitting, canSubmit: state.canSubmit })}
      >
        {(state) => (
          <Button
            type="submit"
            className="self-end"
            disabled={state.submitting || !state.canSubmit || saveState === "conflict"}
          >
            {state.submitting ? (
              <Spinner data-icon="inline-start" aria-hidden />
            ) : (
              <Save data-icon="inline-start" aria-hidden />
            )}
            {data.profile ? "บันทึกข้อมูลโปรไฟล์" : "ยืนยันลงทะเบียนผู้เข้าร่วม"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
