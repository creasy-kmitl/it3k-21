// Fields for a division's (or a round's) scoring settings: the engine, then
// the settings that engine reads. The division settings form owns the value.
import {
  ENGINE_LABELS,
  type EndsConfig,
  type PointsConfig,
  type RaceConfig,
  type ScoringConfig,
  type ScoringEngine,
  type SeriesConfig,
  type SetsConfig,
  SCORING_ENGINES,
} from "@it3k/db/competition-rules";
import { DIVISION_PRESETS } from "@it3k/db/scoring/presets";
import { Checkbox } from "@it3k/ui/components/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import { useId, useState } from "react";

import { ChoiceField } from "../form-dialog";

export type ScoringConfigFieldsProps = {
  value: ScoringConfig;
  onChange: (value: ScoringConfig) => void;
  disabled?: boolean;
};

const preset = (code: string) => DIVISION_PRESETS[code]?.scoringConfig as ScoringConfig;

/** Where each engine starts when staff switch to it. */
export const ENGINE_DEFAULTS: Record<ScoringEngine, () => ScoringConfig> = {
  points: () => preset("football"),
  sets: () => preset("badminton-singles-male"),
  series: () => preset("folk-tug-of-war"),
  ends: () => preset("petanque-male"),
  race: () => preset("athletics-100m-male"),
};

export function ScoringConfigFields({ value, onChange, disabled }: ScoringConfigFieldsProps) {
  const id = useId();
  return (
    <FieldGroup>
      <ChoiceField<ScoringEngine>
        id={`${id}-engine`}
        label="วิธีนับคะแนน"
        value={value.engine}
        options={SCORING_ENGINES.map((engine) => ({ value: engine, label: ENGINE_LABELS[engine] }))}
        onChange={(engine) => engine !== value.engine && onChange(ENGINE_DEFAULTS[engine]())}
      />
      <fieldset disabled={disabled} className="contents">
        {value.engine === "points" && <PointsFields value={value} onChange={onChange} />}
        {value.engine === "sets" && <SetsFields value={value} onChange={onChange} />}
        {value.engine === "series" && <SeriesFields value={value} onChange={onChange} />}
        {value.engine === "ends" && <EndsFields value={value} onChange={onChange} />}
        {value.engine === "race" && <RaceFields value={value} onChange={onChange} />}
      </fieldset>
    </FieldGroup>
  );
}

type EngineProps<C> = { value: C; onChange: (value: C) => void };

function NumberField({
  label,
  value,
  onChange,
  min = 1,
  max,
  optional,
  description,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max: number;
  // Empty means "none" (no cap, no target).
  optional?: boolean;
  description?: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        placeholder={optional ? "ไม่กำหนด" : undefined}
        value={value ?? ""}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") {
            if (optional) onChange(null);
            return;
          }
          const next = Math.round(Number(raw));
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
        }}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function TextInputField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={40}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <Field orientation="horizontal">
      <Checkbox id={id} checked={checked} onCheckedChange={(next) => onChange(next)} />
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
    </Field>
  );
}

/** Whole numbers typed as "8, 7, 6"; keeps the text while it does not parse. */
export function parseNumberList(text: string, max: number): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  const numbers = parts.map(Number);
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > max)) return null;
  return numbers;
}

function ListField({
  label,
  value,
  onChange,
  max,
  description,
  optional,
}: {
  label: string;
  value: number[] | null;
  onChange: (value: number[] | null) => void;
  max: number;
  description: string;
  optional?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(value?.join(", ") ?? "");
  const parsed = parseNumberList(text, max);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        value={text}
        aria-invalid={text.trim() !== "" && parsed === null}
        placeholder={optional ? "ไม่กำหนด" : undefined}
        onChange={(event) => {
          setText(event.target.value);
          const next = parseNumberList(event.target.value, max);
          if (next) onChange(next);
          else if (optional && event.target.value.trim() === "") onChange(null);
        }}
      />
      <FieldDescription>{description}</FieldDescription>
    </Field>
  );
}

function PointsFields({ value, onChange }: EngineProps<PointsConfig>) {
  const set = (patch: Partial<PointsConfig>) => onChange({ ...value, ...patch });
  return (
    <>
      <ListField
        label="ปุ่มเพิ่มคะแนน"
        value={value.buttons}
        max={10}
        description="แต้มที่กดได้ คั่นด้วยจุลภาค เช่น 1, 2, 3 (สูงสุด 6 ปุ่ม)"
        onChange={(buttons) =>
          buttons && buttons.length <= 6 && !buttons.includes(0) && set({ buttons })
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="จำนวนช่วง"
          value={value.periods.count}
          max={8}
          onChange={(count) => count && set({ periods: { ...value.periods, count } })}
        />
        <TextInputField
          label="ชื่อช่วง"
          value={value.periods.label}
          onChange={(label) => set({ periods: { ...value.periods, label } })}
        />
      </div>
      <CheckField
        label="เสมอได้ (เช่น รอบแบ่งกลุ่ม)"
        checked={value.allowDraw}
        onChange={(allowDraw) => set({ allowDraw })}
      />
      <CheckField
        label="ต่อเวลาเมื่อเสมอ"
        checked={value.overtime !== null}
        onChange={(on) => set({ overtime: on ? { label: "ต่อเวลา" } : null })}
      />
      {value.overtime && (
        <TextInputField
          label="ชื่อช่วงต่อเวลา"
          value={value.overtime.label}
          onChange={(label) => set({ overtime: { label } })}
        />
      )}
      <CheckField
        label="ยิงโทษเมื่อยังเสมอ"
        checked={value.shootout !== null}
        onChange={(on) => set({ shootout: on ? { label: "ยิงโทษ", kicks: 5 } : null })}
      />
      {value.shootout && (
        <div className="grid grid-cols-2 gap-3">
          <TextInputField
            label="ชื่อการยิงโทษ"
            value={value.shootout.label}
            onChange={(label) => set({ shootout: { ...(value.shootout ?? { kicks: 5 }), label } })}
          />
          <NumberField
            label="จำนวนครั้งต่อฝ่าย"
            value={value.shootout.kicks}
            max={10}
            onChange={(kicks) =>
              kicks && set({ shootout: { ...(value.shootout ?? { label: "ยิงโทษ" }), kicks } })
            }
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="แต้มที่ชนะทันที"
          value={value.targetScore}
          max={200}
          optional
          description="เช่น บาสเกตบอล 3x3 ถึง 15"
          onChange={(targetScore) =>
            set({ targetScore, ...(targetScore === null ? { targetWinBy: null } : {}) })
          }
        />
        <NumberField
          label="ต้องนำอย่างน้อย"
          value={value.targetWinBy}
          max={5}
          optional
          onChange={(targetWinBy) => set({ targetWinBy })}
        />
      </div>
      <CheckField
        label="ใช้นาฬิกาจับเวลา"
        checked={value.clock !== null}
        onChange={(on) => set({ clock: on ? { periodSeconds: 600, overtimeSeconds: null } : null })}
      />
      {value.clock && (
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="นาทีต่อช่วง"
            value={Math.round(value.clock.periodSeconds / 60)}
            max={120}
            onChange={(minutes) =>
              minutes &&
              set({
                clock: {
                  ...(value.clock ?? { overtimeSeconds: null }),
                  periodSeconds: minutes * 60,
                },
              })
            }
          />
          <NumberField
            label="นาทีต่อเวลา"
            value={
              value.clock.overtimeSeconds === null
                ? null
                : Math.round(value.clock.overtimeSeconds / 60)
            }
            max={60}
            optional
            onChange={(minutes) =>
              set({
                clock: {
                  ...(value.clock ?? { periodSeconds: 600 }),
                  overtimeSeconds: minutes === null ? null : minutes * 60,
                },
              })
            }
          />
        </div>
      )}
    </>
  );
}

function SetsFields({ value, onChange }: EngineProps<SetsConfig>) {
  const set = (patch: Partial<SetsConfig>) => onChange({ ...value, ...patch });
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="แต้มต่อเซต"
        value={value.pointsPerSet}
        max={99}
        onChange={(pointsPerSet) => pointsPerSet && set({ pointsPerSet })}
      />
      <NumberField
        label="ต้องห่างอย่างน้อย"
        value={value.winBy}
        max={5}
        onChange={(winBy) => winBy && set({ winBy })}
      />
      <NumberField
        label="แต้มสูงสุด"
        value={value.cap}
        max={99}
        optional
        description="ถึงแต้มนี้ชนะเซตเลย เช่น 21"
        onChange={(cap) => set({ cap })}
      />
      <NumberField
        label="ชนะกี่เซตจึงชนะแมตช์"
        value={value.setsToWin}
        max={5}
        onChange={(setsToWin) => setsToWin && set({ setsToWin })}
      />
      <NumberField
        label="พักเมื่อผู้นำถึง"
        value={value.intervalAt}
        max={99}
        optional
        onChange={(intervalAt) => set({ intervalAt })}
      />
      <TextInputField
        label="ชื่อเซต"
        value={value.setLabel}
        onChange={(setLabel) => set({ setLabel })}
      />
    </div>
  );
}

function SeriesFields({ value, onChange }: EngineProps<SeriesConfig>) {
  const set = (patch: Partial<SeriesConfig>) => onChange({ ...value, ...patch });
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="ชนะกี่ครั้งจึงชนะแมตช์"
          value={value.gamesToWin}
          max={9}
          onChange={(gamesToWin) => gamesToWin && set({ gamesToWin })}
        />
        <TextInputField
          label="ชื่อแต่ละเกม"
          value={value.gameLabel}
          onChange={(gameLabel) => set({ gameLabel })}
        />
      </div>
      <CheckField
        label="นับจากผลแมตช์ย่อย (เช่น ปิงปองประเภททีม)"
        checked={value.fromSubMatches}
        onChange={(fromSubMatches) => set({ fromSubMatches })}
      />
    </>
  );
}

function EndsFields({ value, onChange }: EngineProps<EndsConfig>) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField
        label="แต้มสูงสุดต่อเอนด์"
        value={value.maxPerEnd}
        max={12}
        onChange={(maxPerEnd) => maxPerEnd && onChange({ ...value, maxPerEnd })}
      />
      <NumberField
        label="แต้มที่ชนะ"
        value={value.targetScore}
        max={99}
        onChange={(targetScore) => targetScore && onChange({ ...value, targetScore })}
      />
    </div>
  );
}

function RaceFields({ value, onChange }: EngineProps<RaceConfig>) {
  const id = useId();
  const set = (patch: Partial<RaceConfig>) => onChange({ ...value, ...patch });
  return (
    <>
      <ChoiceField<RaceConfig["measure"]>
        id={`${id}-measure`}
        label="วัดผลจาก"
        value={value.measure}
        options={[
          { value: "time", label: "เวลา (น้อยชนะ)" },
          { value: "distance", label: "ระยะ (มากชนะ)" },
          { value: "placement", label: "อันดับในแต่ละเกม" },
        ]}
        onChange={(measure) =>
          set({
            measure,
            lowerIsBetter: measure === "time",
            ...(measure === "placement" && !value.placementPoints
              ? { placementPoints: [8, 7, 6, 5, 4, 3, 2, 1] }
              : {}),
          })
        }
      />
      <ListField
        label="คะแนนตามอันดับ"
        value={value.placementPoints}
        max={100}
        optional
        description="คะแนนของอันดับ 1, 2, 3, ... คั่นด้วยจุลภาค เช่น 8, 7, 6, 5, 4, 3, 2, 1"
        onChange={(placementPoints) =>
          (placementPoints === null || placementPoints.length <= 16) && set({ placementPoints })
        }
      />
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label="จำนวนเกม"
          value={value.games}
          max={10}
          onChange={(games) => games && set({ games })}
        />
        <ChoiceField<RaceConfig["decideBy"]>
          id={`${id}-decide`}
          label="ตัดสินจาก"
          value={value.decideBy}
          options={[
            { value: "total", label: "ผลรวมทุกเกม" },
            { value: "gameWins", label: "จำนวนเกมที่ชนะ" },
          ]}
          onChange={(decideBy) => set({ decideBy })}
        />
      </div>
    </>
  );
}
