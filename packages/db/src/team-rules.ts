// Teams of a division, shared by the API and the web app: what a team may look
// like, what it still lacks, and how it is named. Kept free of Drizzle so the
// browser bundle can import it.
import { z } from "zod";

import type { GenderMinimums } from "./competition-rules";
import { INSTITUTION_IDS, INSTITUTIONS, type Institution } from "./profile";
import type { DivisionFormat, RegistrationStatus } from "./sport-rules";

export type MemberGender = "male" | "female";

/** The athlete's gender as their title tells it; null when they gave none. */
export function genderFromPrefix(prefix: string | null | undefined): MemberGender | null {
  if (prefix === "นาย") return "male";
  if (prefix === "นาง" || prefix === "นางสาว") return "female";
  return null;
}

export const MEMBER_GENDER_LABELS: Record<MemberGender, string> = {
  male: "ชาย",
  female: "หญิง",
};

type SizeSettings = {
  format: DivisionFormat;
  teamMinSize: number | null;
  teamMaxSize: number | null;
};

/** How many athletes a team needs; a null limit means the format implies it (1 alone, 2 a pair). */
export function teamSizeLimits(division: SizeSettings): { min: number; max: number | null } {
  const implied = division.format === "individual" ? 1 : division.format === "pair" ? 2 : null;
  return {
    min: division.teamMinSize ?? implied ?? 1,
    max: division.teamMaxSize ?? implied,
  };
}

export type TeamIssueSettings = SizeSettings & {
  genderMinimums: GenderMinimums | null;
  maxOfficials: number;
};

export type TeamIssueMember = {
  gender: MemberGender | null;
  status: RegistrationStatus;
};

export type TeamIssueCode =
  | "tooFew"
  | "tooMany"
  | "genderMinimum"
  | "notApproved"
  | "tooManyOfficials";

export type TeamIssue = { code: TeamIssueCode; message: string };

/**
 * What still keeps a team from the division's rules: its size, the gender
 * minimums, members whose registration is no longer approved, and too many
 * officials. An empty list means the team is ready.
 */
export function teamIssues(
  division: TeamIssueSettings,
  members: readonly TeamIssueMember[],
  officialCount: number,
): TeamIssue[] {
  const issues: TeamIssue[] = [];
  const { min, max } = teamSizeLimits(division);
  const size = members.length;
  if (size < min) {
    issues.push({ code: "tooFew", message: `นักกีฬา ${size} คน ต้องมีอย่างน้อย ${min} คน` });
  }
  if (max !== null && size > max) {
    issues.push({ code: "tooMany", message: `นักกีฬา ${size} คน มีได้ไม่เกิน ${max} คน` });
  }
  for (const gender of ["male", "female"] as const) {
    const needed = division.genderMinimums?.[gender] ?? 0;
    const count = members.filter((member) => member.gender === gender).length;
    if (count < needed) {
      issues.push({
        code: "genderMinimum",
        message: `ต้องมีนักกีฬา${MEMBER_GENDER_LABELS[gender]}อย่างน้อย ${needed} คน (มี ${count} คน)`,
      });
    }
  }
  const notApproved = members.filter((member) => member.status !== "approved").length;
  if (notApproved > 0) {
    issues.push({
      code: "notApproved",
      message: `นักกีฬา ${notApproved} คนไม่ได้รับอนุมัติแล้ว นำออกจากทีม`,
    });
  }
  if (officialCount > division.maxOfficials) {
    issues.push({
      code: "tooManyOfficials",
      message: `เจ้าหน้าที่ทีม ${officialCount} คน มีได้ไม่เกิน ${division.maxOfficials} คน`,
    });
  }
  return issues;
}

export const institutionShort = (institution: Institution) =>
  INSTITUTIONS.find((item) => item.id === institution)?.short ?? institution;

/**
 * A team's name as lists show it: its own name, else the institution's short
 * name, numbered when the institution may field more than one team.
 */
export function teamLabel(
  team: { name: string | null; institution: Institution; seq: number },
  numbered: boolean,
) {
  if (team.name) return team.name;
  const short = institutionShort(team.institution);
  return numbered ? `${short} ทีม ${team.seq}` : short;
}

/** The lowest team number from 1 that no team uses yet. */
export function nextFreeSeq(taken: readonly number[]) {
  const used = new Set(taken);
  let seq = 1;
  while (used.has(seq)) seq++;
  return seq;
}

/**
 * Deals athletes into `teamCount` teams in turn (1, 2, …, n, 1, 2, …). A
 * division played by rank (badminton มือ 1, มือ 2) puts each ranked athlete in
 * the team of that number first, then deals the rest.
 */
export function dealIntoTeams<T extends { badmintonRank: number | null }>(
  athletes: readonly T[],
  teamCount: number,
  byRank: boolean,
): T[][] {
  const teams: T[][] = Array.from({ length: teamCount }, () => []);
  const rest: T[] = [];
  for (const athlete of athletes) {
    const rank = athlete.badmintonRank;
    const team = byRank && rank !== null && rank <= teamCount ? teams[rank - 1] : undefined;
    if (team) team.push(athlete);
    else rest.push(athlete);
  }
  rest.forEach((athlete, index) => {
    teams[index % teamCount]?.push(athlete);
  });
  return teams;
}

const version = z.number().int().min(0);

export const teamRenameInput = z.strictObject({
  name: z.string().trim().max(60).nullable(),
  version,
});

/** One team gets every approved athlete, or they are dealt into `teamCount` teams. */
export const teamAutoInput = z.strictObject({
  divisionId: z.string().min(1),
  institution: z.enum(INSTITUTION_IDS),
  teamCount: z.number().int().min(1).max(20),
});
export type TeamAutoInput = z.infer<typeof teamAutoInput>;

/**
 * Sports whose teams are always arranged by hand: badminton singles go by
 * มือ 1 and มือ 2, and its pairs are chosen, so "auto for every division"
 * leaves them out.
 */
export const AUTO_TEAMS_SKIPPED_SPORTS = ["badminton"] as const;

export const teamAutoAllInput = z.strictObject({
  /** Only work out what would be made, without writing anything. */
  dryRun: z.boolean(),
});

export type AutoTeamsSkip = "arranged";

/**
 * What "auto for every division" does to one division: each institution with
 * approved athletes and no members in any team gets one team holding all of
 * them, reusing its lowest-numbered empty team if it has one. Institutions
 * that already put anyone in a team are left alone.
 */
export function planDivisionTeams<A extends { institution: Institution }>(
  teams: readonly {
    id: string;
    institution: Institution;
    seq: number;
    version: number;
    members: number;
  }[],
  approved: readonly A[],
) {
  const create: { institution: Institution; team: { id: string; version: number } | null; athletes: A[] }[] = [];
  const skipped: { institution: Institution; reason: AutoTeamsSkip }[] = [];
  for (const institution of INSTITUTION_IDS) {
    const athletes = approved.filter((athlete) => athlete.institution === institution);
    if (athletes.length === 0) continue;
    const own = teams
      .filter((team) => team.institution === institution)
      .toSorted((a, b) => a.seq - b.seq);
    if (own.some((team) => team.members > 0)) {
      skipped.push({ institution, reason: "arranged" });
      continue;
    }
    const empty = own[0];
    create.push({
      institution,
      team: empty ? { id: empty.id, version: empty.version } : null,
      athletes,
    });
  }
  return { create, skipped };
}
