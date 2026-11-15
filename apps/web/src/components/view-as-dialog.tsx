import { Button } from "@it3k/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@it3k/ui/components/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { INSTITUTIONS, type Institution } from "@it3k/db/profile";
import { useMutation, useQuery } from "@tanstack/react-query";
import { EyeIcon } from "lucide-react";
import { useState } from "react";

import { DepartmentLabel } from "@/components/department-icon";
import { LoadingButton } from "@/components/loading-button";
import { ROLE_BADGES } from "@/components/role-badge";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";
import { type ViewAsApi, type ViewAsKind, reloadAt, viewAsApi } from "@/lib/view-as";

const KINDS: ViewAsKind[] = ["guest", "participant", "athlete", "staff", "vicehead", "head"];
const NEEDS_DEPARTMENT = new Set<ViewAsKind>(["staff", "vicehead", "head"]);
const NO_INSTITUTION = "none";

/**
 * Lets an admin pick a role, department and institution and view the app as
 * it, read-only. Starting reloads the app so every page and menu picks it up.
 */
export function ViewAsDialog({
  api = viewAsApi,
  navigate = reloadAt,
  onClose,
}: {
  api?: ViewAsApi;
  navigate?: (path: string) => void;
  onClose: () => void;
}) {
  const { leadership } = useApis();
  const [kind, setKind] = useState<ViewAsKind>("staff");
  const [departmentId, setDepartmentId] = useState("");
  const [institution, setInstitution] = useState<Institution | null>(null);
  const needsDepartment = NEEDS_DEPARTMENT.has(kind);

  const departments = useQuery({
    queryKey: ["leadership", "departments"],
    queryFn: () => leadership.departments(),
    staleTime: 5 * 60_000,
  });

  const start = useMutation({
    mutationFn: () =>
      api.start(
        kind === "staff" || kind === "head" || kind === "vicehead"
          ? { kind, departmentId, institution }
          : { kind, institution },
      ),
    // The staff layout sends roles without staff access on to /me or /pending.
    onSuccess: () => navigate("/staff/dashboard"),
    onError: (error) => toastError(error, "เริ่มจำลองมุมมองไม่สำเร็จ"),
  });

  const kindItems = KINDS.map((value) => ({ value, label: ROLE_BADGES[value].label }));
  const departmentItems = (departments.data ?? []).map((d) => ({
    value: d.id,
    label: <DepartmentLabel department={d} />,
  }));
  const institutionItems = [
    { value: NO_INSTITUTION, label: "ไม่ระบุ" },
    ...INSTITUTIONS.map((i) => ({ value: i.id, label: i.short })),
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-6"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            start.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>จำลองมุมมอง</DialogTitle>
            <DialogDescription>
              ดูระบบอย่างที่บทบาทนี้เห็น ระหว่างจำลองจะแก้ไขข้อมูลไม่ได้ ออกได้ทุกเมื่อจากแถบด้านล่าง
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="view-as-kind">บทบาท</FieldLabel>
              <Select
                items={kindItems}
                value={kind}
                onValueChange={(value: ViewAsKind | null) => value && setKind(value)}
              >
                <SelectTrigger id="view-as-kind" aria-label="บทบาท">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {kindItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {needsDepartment && (
              <Field>
                <FieldLabel htmlFor="view-as-department">ฝ่าย</FieldLabel>
                <Select
                  items={departmentItems}
                  value={departmentId || null}
                  onValueChange={(value: string | null) => setDepartmentId(value ?? "")}
                >
                  <SelectTrigger id="view-as-department" aria-label="ฝ่าย">
                    <SelectValue placeholder="เลือกฝ่าย" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {departmentItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="view-as-institution">สถาบัน</FieldLabel>
              <Select
                items={institutionItems}
                value={institution ?? NO_INSTITUTION}
                onValueChange={(value: string | null) =>
                  setInstitution(!value || value === NO_INSTITUTION ? null : (value as Institution))
                }
              >
                <SelectTrigger id="view-as-institution" aria-label="สถาบัน">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {institutionItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>มีผลกับสิ่งที่ฝ่ายทะเบียนและนักกีฬาเห็นในระบบกีฬา</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              ยกเลิก
            </Button>
            <LoadingButton
              type="submit"
              icon={EyeIcon}
              loading={start.isPending}
              disabled={needsDepartment && departmentId === ""}
            >
              เริ่มจำลอง
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
