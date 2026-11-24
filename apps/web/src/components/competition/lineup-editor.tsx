// Placeholder with the props the match page passes. The teams stream (B1)
// builds the editor: pick starters and subs from the team, within the
// division's limits, and save them for this match.
export type LineupEditorProps = {
  matchId: string;
  participantId: string;
  teamId: string;
  // The division's limits; null means the match needs no lineup.
  starters: number | null;
  maxSubs: number | null;
  canEdit: boolean;
  onSaved?: () => void;
};

export function LineupEditor(_props: LineupEditorProps) {
  return null;
}
