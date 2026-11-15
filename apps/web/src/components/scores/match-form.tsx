import {
  MATCH_STATUSES,
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
import { type FormEvent, useId, useState } from "react";

import { fromDatetimeLocal, toDatetimeLocal } from "@/lib/bangkok-time";
import { type Match, type MatchInput, STATUS_LABELS, universityLabel } from "@/lib/matches";

const universityItems = UNIVERSITIES.map((value) => ({ value, label: universityLabel(value) }));
const statusItems = MATCH_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

/** Blank means no score yet; anything else must be a whole number in range. */
function parseScore(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value <= SCORE_MAX ? value : undefined;
}

/** Creates a match, or edits every field of one, scores included. */
export function MatchForm({
  initial,
  sports,
  pending,
  onSubmit,
  onCancel,
}: {
  initial?: Match;
  /** Sports already used, offered as suggestions. */
  sports: string[];
  pending: boolean;
  onSubmit: (input: MatchInput) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [sport, setSport] = useState(initial?.sport ?? "");
  const [round, setRound] = useState(initial?.round ?? "");
  const [teamA, setTeamA] = useState<University>(initial?.teamA ?? "kmutt");
  const [teamB, setTeamB] = useState<University>(initial?.teamB ?? "kmutnb");
  const [scoreA, setScoreA] = useState(initial?.scoreA?.toString() ?? "");
  const [scoreB, setScoreB] = useState(initial?.scoreB?.toString() ?? "");
  const [status, setStatus] = useState<MatchStatus>(initial?.status ?? "scheduled");
  const [startsAt, setStartsAt] = useState(
    initial?.startsAt ? toDatetimeLocal(initial.startsAt) : "",
  );
  const [submitted, setSubmitted] = useState(false);

  const parsedA = parseScore(scoreA);
  const parsedB = parseScore(scoreB);
  const problems = {
    sport: sport.trim() === "" ? "กรุณาใส่ชื่อกีฬา" : null,
    teams: teamA === teamB ? "ต้องเลือกสองสถาบันที่ต่างกัน" : null,
    scores:
      parsedA === undefined || parsedB === undefined
        ? `คะแนนต้องเป็นจำนวนเต็ม 0–${SCORE_MAX} หรือเว้นว่าง`
        : null,
  };
  const valid = Object.values(problems).every((problem) => problem === null);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitted(true);
    if (!valid || parsedA === undefined || parsedB === undefined) return;
    onSubmit({
      sport: sport.trim(),
      round: round.trim() || null,
      teamA,
      teamB,
      scoreA: parsedA,
      scoreB: parsedB,
      status,
      startsAt: startsAt ? fromDatetimeLocal(startsAt) : null,
    });
  }

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <Field data-invalid={submitted && problems.sport ? true : undefined}>
          <FieldLabel htmlFor={`${id}-sport`}>กีฬา</FieldLabel>
          <Input
            id={`${id}-sport`}
            list={`${id}-sports`}
            maxLength={SPORT_MAX}
            value={sport}
            onChange={(event) => setSport(event.target.value)}
            aria-invalid={submitted && problems.sport ? true : undefined}
          />
          <datalist id={`${id}-sports`}>
            {sports.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {submitted && problems.sport && <FieldError>{problems.sport}</FieldError>}
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
                  value={team}
                  onValueChange={(next: string | null) => next && setTeam(next as University)}
                >
                  <SelectTrigger id={`${id}-team-${side}`} className="w-full">
                    <SelectValue />
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
            </div>
          ))}
        </div>
        {submitted && problems.teams && <FieldError>{problems.teams}</FieldError>}
        {submitted && problems.scores && <FieldError>{problems.scores}</FieldError>}

        <Field>
          <FieldLabel htmlFor={`${id}-status`}>สถานะ</FieldLabel>
          <Select
            items={statusItems}
            value={status}
            onValueChange={(next: string | null) => next && setStatus(next as MatchStatus)}
          >
            <SelectTrigger id={`${id}-status`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel htmlFor={`${id}-starts`}>เวลาแข่ง (ไม่บังคับ)</FieldLabel>
          <Input
            id={`${id}-starts`}
            type="datetime-local"
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
          />
        </Field>

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
