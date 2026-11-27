// The dialog that builds an empty knockout bracket for a division: how many
// teams and whether there is a third-place match, with the matches it will
// make listed by round before staff confirm.
import { BRACKET_SIZES, type BracketSize, planBracket } from "@it3k/db/competition-rules";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldError } from "@it3k/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Medal, Network, Shapes, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { FormDialog, FormLabel } from "@/components/form-dialog";
import { SegmentedControl } from "@/components/segmented-control";
import { useApis } from "@/lib/api-context";
import { toastError } from "@/lib/errors";

import { divisionSelectItems } from "./division-items";
import type { MatchFormDivision } from "./match-form";
import { MatchSelect } from "./match-select";

/** "รอบรองชนะเลิศ 2 แมตช์", one line per round in play order. */
export function bracketSummary(teams: BracketSize, thirdPlace: boolean) {
  const rounds = new Map<string, number>();
  for (const match of planBracket(teams, thirdPlace)) {
    rounds.set(match.stageName, (rounds.get(match.stageName) ?? 0) + 1);
  }
  return [...rounds.entries()].map(([stageName, count]) => ({ stageName, count }));
}

export function BracketBuilder({
  divisions,
  divisionId: initialDivisionId,
  onClose,
  onBuilt,
}: {
  divisions: MatchFormDivision[];
  divisionId: string | null;
  onClose: () => void;
  onBuilt: (divisionId: string) => void;
}) {
  const { competitionMatches: api } = useApis();
  const queryClient = useQueryClient();
  const [divisionId, setDivisionId] = useState<string | null>(initialDivisionId);
  const [teams, setTeams] = useState<BracketSize>(4);
  const [thirdPlace, setThirdPlace] = useState(true);
  const [missingDivision, setMissingDivision] = useState(false);
  const summary = bracketSummary(teams, thirdPlace);
  const total = summary.reduce((sum, round) => sum + round.count, 0);

  const build = useMutation({
    mutationFn: (id: string) => api.createBracket({ divisionId: id, teams, thirdPlace }),
    onSuccess: (result, id) => {
      toast.success(`สร้างสายการแข่งแล้ว ${result.matchIds.length} แมตช์`);
      void queryClient.invalidateQueries({ queryKey: ["competition-matches"] });
      onBuilt(id);
    },
    onError: (error) => toastError(error, "สร้างสายการแข่งไม่สำเร็จ"),
  });

  return (
    <FormDialog
      title="เพิ่มสายการแข่ง"
      icon={Network}
      description="สร้างแมตช์น็อกเอาต์ทั้งสายพร้อมผูกผู้ชนะต่อกันให้ ใส่ทีม เวลา และสนามทีหลังได้ในแต่ละแมตช์"
      submitLabel={`สร้าง ${total} แมตช์`}
      submitIcon={Network}
      pending={build.isPending}
      onClose={onClose}
      onSubmit={() => {
        if (!divisionId) {
          setMissingDivision(true);
          return;
        }
        build.mutate(divisionId);
      }}
    >
      <Field data-invalid={missingDivision}>
        <FormLabel htmlFor="bracket-division" icon={Shapes}>
          ประเภท
        </FormLabel>
        <MatchSelect
          id="bracket-division"
          label="ประเภท"
          placeholder="เลือกประเภท"
          searchPlaceholder="ค้นหากีฬาหรือประเภท"
          icon={<Shapes aria-hidden className="text-muted-foreground" />}
          invalid={missingDivision}
          items={divisionSelectItems(divisions)}
          value={divisionId}
          onChange={(next) => {
            setDivisionId(next);
            setMissingDivision(false);
          }}
        />
        <FieldError>{missingDivision ? "เลือกประเภท" : undefined}</FieldError>
      </Field>

      <Field>
        <span className="flex items-center gap-2 text-sm font-medium">
          <Users className="size-4 text-muted-foreground" aria-hidden /> จำนวนทีม
        </span>
        <SegmentedControl<BracketSize>
          label="จำนวนทีม"
          className="w-fit"
          segments={BRACKET_SIZES.map((size) => ({ value: size, label: `${size} ทีม` }))}
          value={teams}
          onChange={setTeams}
        />
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="bracket-third"
          checked={thirdPlace}
          onCheckedChange={(checked) => setThirdPlace(checked)}
        />
        <FormLabel htmlFor="bracket-third" icon={Medal} className="font-normal">
          มีนัดชิงอันดับ 3 (ผู้แพ้รอบรองชนะเลิศ)
        </FormLabel>
      </Field>

      <section aria-label="แมตช์ที่จะสร้าง" className="rounded-2xl bg-muted/50 p-3 text-sm">
        <p className="mb-2 font-medium">จะสร้าง {total} แมตช์</p>
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {summary.map((round) => (
            <li key={round.stageName} className="flex justify-between gap-2">
              <span>{round.stageName}</span>
              <span className="tabular-nums">{round.count} แมตช์</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          รอบแรกตั้งชื่อเป็น “ทีมที่ 1” ถึง “ทีมที่ {teams}” ไว้ก่อน รอบถัดไปรอผู้ชนะ
        </p>
      </section>
    </FormDialog>
  );
}
