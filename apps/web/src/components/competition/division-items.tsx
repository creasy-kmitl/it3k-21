// Divisions as select choices: listed under their sport, with its picture,
// so a long list of "ชาย / หญิง / ผสม" stays readable and searchable by sport.
import type { SportIcon } from "@it3k/db/sport-rules";

import type { IconSelectItem } from "@/components/icon-select";
import { SportMark } from "@/components/sport-art";

export type DivisionChoice = {
  id: string;
  name: string;
  sportId: string;
  sportName: string;
  sportIcon: SportIcon;
};

/** "กีฬาแบดมินตัน" → "แบดมินตัน", the word a division's own name may already carry. */
function sportWord(sportName: string) {
  return sportName.replace(/^กีฬา/, "").trim();
}

/**
 * One choice per division, grouped by sport. The closed select reads "กีฬา · ประเภท"
 * unless the division's name already says the sport ("แบดมินตัน เดี่ยวชาย").
 */
export function divisionSelectItems(divisions: DivisionChoice[]): IconSelectItem<string>[] {
  return divisions.map((d) => {
    const mark = <SportMark icon={d.sportIcon} seed={d.sportId} />;
    return {
      value: d.id,
      label: d.name,
      icon: mark,
      group: d.sportName,
      groupIcon: mark,
      triggerLabel: d.name.includes(sportWord(d.sportName)) ? d.name : `${d.sportName} · ${d.name}`,
    };
  });
}
