import {
  ANNOUNCE_MODES,
  type AnnounceMode,
  SCORING_MODES,
  SETS_TO_WIN_OPTIONS,
  type ScoringMode,
  BREAKS_MAX,
  BREAK_MAX,
  DIVISION_MAX,
  DURATION_MAX,
  MATCH_STATUSES,
  type MatchBreak,
  type MatchStatus,
  ROUND_MAX,
  SCORE_MAX,
  SPORT_MAX,
  UNIVERSITIES,
  type University,
} from "@it3k/db/match-rules";
import { Button } from "@it3k/ui/components/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@it3k/ui/components/field";
import { Input } from "@it3k/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@it3k/ui/components/select";
import { Spinner } from "@it3k/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useId, useState } from "react";

import { MatchTimeline } from "@/components/scores/match-timeline";
import { useApis } from "@/lib/api-context";
import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import {
  ANNOUNCE_LABELS,
  SCORING_LABELS,
  SETS_TO_WIN_LABELS,
  type Match,
  type MatchInput,
  type MatchUpdate,
  STATUS_LABELS,
  universityLabel,
} from "@/lib/matches";

/** The "other" choice in the sport and division lists, which opens a box to type the name. */
const OTHER = "__other";
/** The "no division" choice in the division list. */
const NO_DIVISION = "__none";

const universityItems = UNIVERSITIES.map((value) => ({ value, label: universityLabel(value) }));
const scoringItems = SCORING_MODES.map((value) => ({ value, label: SCORING_LABELS[value] }));
const setsItems = SETS_TO_WIN_OPTIONS.map((value) => ({
  value: String(value),
  label: SETS_TO_WIN_LABELS[value] ?? String(value),
}));
const announceItems = ANNOUNCE_MODES.map((value) => ({ value, label: ANNOUNCE_LABELS[value] }));
const statusItems = MATCH_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

/** Blank is null; a whole number from `min` to `max` is that number; anything else is undefined. */
function parseWhole(text: string, min: number, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : undefined;
}

/** One break row as typed; `key` keeps React's rows straight when one is removed. */
type BreakRow = { key: string; atMinute: string; minutes: string };

const newBreakRow = (pause?: MatchBreak): BreakRow => ({
  key: crypto.randomUUID(),
  atMinute: pause?.atMinute.toString() ?? "",
  minutes: pause?.minutes.toString() ?? "",
});

/**
 * Reads the break rows against the match length. Fully blank rows are skipped;
 * a row with only one box filled is an error, as is a break outside the match
 * or two breaks at the same minute. Good breaks come back sorted by minute.
 */
function readBreaks(rows: BreakRow[], duration: number | null | undefined) {
  const breaks: MatchBreak[] = [];
  const errors = new Map<string, string>();
  for (const row of rows) {
    if (row.atMinute.trim() === "" && row.minutes.trim() === "") continue;
    const atMinute = parseWhole(row.atMinute, 1, DURATION_MAX);
    const minutes = parseWhole(row.minutes, 1, BREAK_MAX);
    if (atMinute == null || minutes == null) {
      errors.set(row.key, `กรอกทั้งนาทีที่พัก และพักนานกี่นาที (1–${BREAK_MAX})`);
    } else if (duration && atMinute >= duration) {
      errors.set(row.key, `ต้องพักก่อนนาทีที่ ${duration}`);
    } else if (breaks.some((other) => other.atMinute === atMinute)) {
      errors.set(row.key, "มีพักที่นาทีนี้แล้ว");
    } else {
      breaks.push({ atMinute, minutes });
    }
  }
  breaks.sort((a, b) => a.atMinute - b.atMinute);
  return { breaks, errors };
}

/** What the form hands back: scores come along only when editing a match. */
export type MatchFormValues = MatchInput & Pick<MatchUpdate, "scoreA" | "scoreB">;

/**
 * Creates a match, or edits one. A new match needs its start time and minutes
 * of play, and always starts at 0 : 0, so scores show only when editing.
 */
export function MatchForm({
  initial,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Match;
  pending: boolean;
  onSubmit: (input: MatchFormValues) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const editing = initial !== undefined;
  const { sports: sportsApi } = useApis();
  const catalog = useQuery({ queryKey: ["sports"], queryFn: () => sportsApi.list() });
  // A sport is picked from the sports page, or typed under "other". `customSport`
  // is the typed one; `sportChoice` holds the picked name, or OTHER.
  const [sportChoice, setSportChoice] = useState(initial?.sport ?? "");
  const [customSport, setCustomSport] = useState("");
  // Same for the division: picked from the sport's list, or typed under OTHER.
  const [divisionChoice, setDivisionChoice] = useState(initial?.division ?? "");
  const [customDivision, setCustomDivision] = useState("");
  const [round, setRound] = useState(initial?.round ?? "");
  // How the result reaches the audience; fixed once the match exists.
  const [announce, setAnnounce] = useState<AnnounceMode | "">(initial?.announce ?? "");
  const after = announce === "after";
  // A pair match says how it is reported; a match with many teams is always a ranking.
  const [scoring, setScoring] = useState<ScoringMode | "">(initial?.scoring ?? "");
  const [setsToWin, setSetsToWin] = useState(initial?.setsToWin?.toString() ?? "");
  const pair = announce === "live";
  // Only a score counted point by point has a length, breaks and a timeline.
  const points = pair && scoring === "points";
  const [teamA, setTeamA] = useState<University | "">(initial?.teamA ?? "");
  const [teamB, setTeamB] = useState<University | "">(initial?.teamB ?? "");
  const [scoreA, setScoreA] = useState(initial?.scoreA?.toString() ?? "");
  const [scoreB, setScoreB] = useState(initial?.scoreB?.toString() ?? "");
  const [status, setStatus] = useState<MatchStatus | "">(initial?.status ?? "");
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? toDatetimeLocal(initial.startsAt) : "",
  );
  const [duration, setDuration] = useState(initial?.durationMinutes?.toString() ?? "");
  const [breakRows, setBreakRows] = useState<BreakRow[]>(
    () => initial?.breaks.map(newBreakRow) ?? [],
  );
  const [submitted, setSubmitted] = useState(false);

  const sports = catalog.data?.items ?? [];
  const known = sports.find((item) => item.name === sportChoice);
  // A sport saved before and no longer on the sports page reads as "other".
  const isOther = sportChoice === OTHER || (sportChoice !== "" && !known && catalog.isSuccess);
  const sport = (sportChoice === OTHER ? customSport : sportChoice).trim();
  const sportItems = [
    ...sports.map((item) => ({ value: item.name, label: item.name })),
    { value: OTHER, label: "อื่นๆ" },
  ];
  const divisionNames = known?.divisions.map((item) => item.name) ?? [];
  // A division saved before and no longer on the sport reads as "other", like a sport does.
  const divisionIsOther =
    divisionChoice === OTHER ||
    (divisionChoice !== "" && known !== undefined && !divisionNames.includes(divisionChoice));
  const division = (divisionChoice === OTHER ? customDivision : divisionChoice).trim();
  const divisionItems = [
    { value: NO_DIVISION, label: "ไม่ระบุประเภท" },
    ...divisionNames.map((name) => ({ value: name, label: name })),
    { value: OTHER, label: "อื่นๆ" },
  ];

  function pickSport(next: string) {
    setSportChoice(next);
    setDivisionChoice("");
  }

  const parsedA = parseWhole(scoreA, 0, SCORE_MAX);
  const parsedB = parseWhole(scoreB, 0, SCORE_MAX);
  const start = startsAt ? fromDatetimeLocal(startsAt) : null;
  const minutes = parseWhole(duration, 1, DURATION_MAX);
  const { breaks, errors: breakErrors } = readBreaks(breakRows, minutes);
  const problems = {
    sport: sport === "" ? (isOther ? "กรุณาใส่ชื่อกีฬา" : "กรุณาเลือกกีฬา") : null,
    announce: !editing && announce === "" ? "กรุณาเลือกรูปแบบการแข่งขัน" : null,
    scoring: !editing && pair && scoring === "" ? "กรุณาเลือกวิธีรายงานผลการแข่งขัน" : null,
    setsToWin:
      !editing && scoring === "sets" && setsToWin === "" ? "กรุณาเลือกจำนวนเซตที่ต้องชนะ" : null,
    teams: !pair
      ? null
      : teamA === "" || teamB === ""
        ? "กรุณาเลือกทีมทั้งสองฝั่ง"
        : teamA === teamB
          ? "ต้องเลือกสองสถาบันที่ต่างกัน"
          : null,
    status: status === "" ? "กรุณาเลือกสถานะ" : null,
    scores:
      editing && points && (parsedA === undefined || parsedB === undefined)
        ? `คะแนนต้องเป็นจำนวนเต็ม 0–${SCORE_MAX} หรือเว้นว่าง`
        : null,
    startsAt: start === null ? "กรุณาเลือกเวลาแข่ง" : null,
    duration:
      points && minutes == null ? `กรุณาใส่เวลาแข่ง 1–${DURATION_MAX} นาที` : null,
    breaks: points && breakErrors.size > 0 ? "แก้ช่วงพักที่ขึ้นสีแดงก่อน" : null,
  };
  const valid = Object.values(problems).every((problem) => problem === null);

  const updateBreakRow = (key: string, change: Partial<BreakRow>) =>
    setBreakRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || start === null || status === "" || announce === "") return;
    const common = {
      sport,
      division: division || null,
      round: round.trim() || null,
      status,
      startsAt: start,
    };
    if (after) {
      // No sides, scores or length: the audience only sees the schedule, then the ranking.
      onSubmit(editing ? common : { ...common, announce });
      return;
    }
    if (teamA === "" || teamB === "" || scoring === "") return;
    const sides = { ...common, teamA, teamB };
    if (scoring === "sets") {
      onSubmit(
        editing ? sides : { ...sides, announce, scoring, setsToWin: Number(setsToWin) },
      );
      return;
    }
    if (scoring === "after") {
      onSubmit(editing ? sides : { ...sides, announce, scoring });
      return;
    }
    if (minutes == null || parsedA === undefined || parsedB === undefined) return;
    onSubmit({
      sport,
      division: division || null,
      round: round.trim() || null,
      ...(editing ? {} : { announce, scoring }),
      teamA,
      teamB,
      status,
      startsAt: start,
      durationMinutes: minutes,
      breaks,
      ...(editing ? { scoreA: parsedA, scoreB: parsedB } : {}),
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        {points && minutes != null && (
          <MatchTimeline durationMinutes={minutes} breaks={breaks} startsAt={start} />
        )}

        <Field data-invalid={submitted && problems.sport ? true : undefined}>
          <FieldLabel htmlFor={`${id}-sport`}>กีฬา</FieldLabel>
          <Select
            items={sportItems}
            value={(isOther ? OTHER : sportChoice) || null}
            onValueChange={(next: string | null) => next && pickSport(next)}
          >
            <SelectTrigger id={`${id}-sport`} className="w-full">
              <SelectValue placeholder="เลือกกีฬา" />
            </SelectTrigger>
            <SelectContent>
              {sportItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isOther && (
            <Input
              aria-label="ชื่อกีฬา"
              placeholder="ชื่อกีฬา"
              maxLength={SPORT_MAX}
              value={sportChoice === OTHER ? customSport : sportChoice}
              onChange={(event) => {
                setSportChoice(OTHER);
                setCustomSport(event.target.value);
              }}
              aria-invalid={submitted && problems.sport ? true : undefined}
            />
          )}
          {submitted && problems.sport && <FieldError>{problems.sport}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-division`}>ประเภท (ไม่บังคับ)</FieldLabel>
          {isOther ? (
            <Input
              id={`${id}-division`}
              placeholder="เช่น ทีมชาย"
              maxLength={DIVISION_MAX}
              value={divisionChoice}
              onChange={(event) => setDivisionChoice(event.target.value)}
            />
          ) : (
            <>
              <Select
                items={divisionItems}
                value={(divisionIsOther ? OTHER : divisionChoice) || null}
                disabled={sportChoice === ""}
                onValueChange={(next: string | null) =>
                  next && setDivisionChoice(next === NO_DIVISION ? "" : next)
                }
              >
                <SelectTrigger id={`${id}-division`} className="w-full">
                  <SelectValue
                    placeholder={sportChoice === "" ? "เลือกกีฬาก่อน" : "เลือกประเภท"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {divisionItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {divisionIsOther && (
                <Input
                  aria-label="ชื่อประเภท"
                  placeholder="ชื่อประเภท"
                  maxLength={DIVISION_MAX}
                  value={divisionChoice === OTHER ? customDivision : divisionChoice}
                  onChange={(event) => {
                    setDivisionChoice(OTHER);
                    setCustomDivision(event.target.value);
                  }}
                />
              )}
            </>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-round`}>รอบ (ไม่บังคับ)</FieldLabel>
          <Input
            id={`${id}-round`}
            placeholder="เช่น รอบแรก, รอบชิง"
            maxLength={ROUND_MAX}
            value={round}
            onChange={(event) => setRound(event.target.value)}
          />
        </Field>

        {!editing && (
          <Field data-invalid={submitted && problems.announce ? true : undefined}>
            <FieldLabel htmlFor={`${id}-announce`}>รูปแบบการแข่งขัน</FieldLabel>
            <Select
              items={announceItems}
              value={announce || null}
              onValueChange={(next: string | null) => next && setAnnounce(next as AnnounceMode)}
            >
              <SelectTrigger id={`${id}-announce`} className="w-full">
                <SelectValue placeholder="เลือกรูปแบบการแข่งขัน" />
              </SelectTrigger>
              <SelectContent>
                {announceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {submitted && problems.announce && <FieldError>{problems.announce}</FieldError>}
          </Field>
        )}

        {!editing && pair && (
          <Field data-invalid={submitted && problems.scoring ? true : undefined}>
            <FieldLabel htmlFor={`${id}-scoring`}>วิธีรายงานผลการแข่งขัน</FieldLabel>
            <Select
              items={scoringItems}
              value={scoring || null}
              onValueChange={(next: string | null) => next && setScoring(next as ScoringMode)}
            >
              <SelectTrigger id={`${id}-scoring`} className="w-full">
                <SelectValue placeholder="เลือกวิธีรายงานผลการแข่งขัน" />
              </SelectTrigger>
              <SelectContent>
                {scoringItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {submitted && problems.scoring && <FieldError>{problems.scoring}</FieldError>}
          </Field>
        )}

        {!editing && scoring === "sets" && (
          <Field data-invalid={submitted && problems.setsToWin ? true : undefined}>
            <FieldLabel htmlFor={`${id}-sets`}>จำนวนเซต</FieldLabel>
            <Select
              items={setsItems}
              value={setsToWin || null}
              onValueChange={(next: string | null) => next && setSetsToWin(next)}
            >
              <SelectTrigger id={`${id}-sets`} className="w-full">
                <SelectValue placeholder="เลือกจำนวนเซต" />
              </SelectTrigger>
              <SelectContent>
                {setsItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {submitted && problems.setsToWin && <FieldError>{problems.setsToWin}</FieldError>}
          </Field>
        )}

        {pair && (
          <>
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              ["A", teamA, setTeamA, scoreA, setScoreA],
              ["B", teamB, setTeamB, scoreB, setScoreB],
            ] as const
          ).map(([side, team, setTeam, score, setScore]) => (
            <div key={side} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor={`${id}-team-${side}`}>ทีม {side}</FieldLabel>
                <Select
                  items={universityItems}
                  value={team || null}
                  onValueChange={(next: string | null) => next && setTeam(next as University)}
                >
                  <SelectTrigger id={`${id}-team-${side}`} className="w-full">
                    <SelectValue placeholder="เลือกทีม" />
                  </SelectTrigger>
                  <SelectContent>
                    {universityItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {editing && points && (
                <Field>
                  <FieldLabel htmlFor={`${id}-score-${side}`}>คะแนนทีม {side}</FieldLabel>
                  <Input
                    id={`${id}-score-${side}`}
                    inputMode="numeric"
                    placeholder="–"
                    value={score}
                    onChange={(event) => setScore(event.target.value)}
                    aria-invalid={submitted && problems.scores ? true : undefined}
                  />
                </Field>
              )}
            </div>
          ))}
        </div>
        {submitted && problems.teams && <FieldError>{problems.teams}</FieldError>}
        {submitted && problems.scores && <FieldError>{problems.scores}</FieldError>}
          </>
        )}

        <Field data-invalid={submitted && problems.status ? true : undefined}>
          <FieldLabel htmlFor={`${id}-status`}>สถานะ</FieldLabel>
          <Select
            items={statusItems}
            value={status || null}
            onValueChange={(next: string | null) => next && setStatus(next as MatchStatus)}
          >
            <SelectTrigger id={`${id}-status`} className="w-full">
              <SelectValue placeholder="เลือกสถานะ" />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {submitted && problems.status && <FieldError>{problems.status}</FieldError>}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={submitted && problems.startsAt ? true : undefined}>
            <FieldLabel htmlFor={`${id}-starts`}>เวลาแข่ง</FieldLabel>
            <Input
              id={`${id}-starts`}
              type="datetime-local"
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              aria-invalid={submitted && problems.startsAt ? true : undefined}
            />
            {submitted && problems.startsAt && <FieldError>{problems.startsAt}</FieldError>}
          </Field>

          {points && (
          <Field data-invalid={submitted && problems.duration ? true : undefined}>
            <FieldLabel htmlFor={`${id}-duration`}>แข่งกี่นาที (ไม่รวมพัก)</FieldLabel>
            <Input
              id={`${id}-duration`}
              type="number"
              inputMode="numeric"
              min={1}
              max={DURATION_MAX}
              placeholder="เช่น 90"
              value={duration}
              onChange={(event) => setDuration(event.target.value)}
              aria-invalid={submitted && problems.duration ? true : undefined}
            />
            {submitted && problems.duration && <FieldError>{problems.duration}</FieldError>}
          </Field>
          )}
        </div>

        {points && (
        <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
          <legend className="mb-3 text-sm font-medium">ช่วงพัก (ไม่บังคับ)</legend>
          {breakRows.map((row, index) => {
            const error = breakErrors.get(row.key);
            const number = index + 1;
            return (
              <Field key={row.key} data-invalid={error ? true : undefined}>
                <div className="flex items-end gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor={`${id}-break-${row.key}-at`}>พักครั้งที่ {number} นาทีที่</FieldLabel>
                    <Input
                      id={`${id}-break-${row.key}-at`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="เช่น 45"
                      value={row.atMinute}
                      onChange={(event) => updateBreakRow(row.key, { atMinute: event.target.value })}
                      aria-invalid={error ? true : undefined}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <FieldLabel htmlFor={`${id}-break-${row.key}-minutes`}>
                      พักครั้งที่ {number} นานกี่นาที
                    </FieldLabel>
                    <Input
                      id={`${id}-break-${row.key}-minutes`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={BREAK_MAX}
                      placeholder="เช่น 15"
                      value={row.minutes}
                      onChange={(event) => updateBreakRow(row.key, { minutes: event.target.value })}
                      aria-invalid={error ? true : undefined}
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`ลบพักครั้งที่ ${number}`}
                    onClick={() => setBreakRows((rows) => rows.filter((other) => other.key !== row.key))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {error && <FieldError>{error}</FieldError>}
              </Field>
            );
          })}
          {breakRows.length < BREAKS_MAX && (
            <Button
              type="button"
              variant="outline"
              className="self-start"
              onClick={() => setBreakRows((rows) => [...rows, newBreakRow()])}
            >
              <Plus data-icon="inline-start" />
              เพิ่มช่วงพัก
            </Button>
          )}
        </fieldset>
        )}
          
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            บันทึก
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
