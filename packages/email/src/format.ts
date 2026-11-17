const TIME_ZONE = "Asia/Bangkok";

const dateFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: TIME_ZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const timeFormat = new Intl.DateTimeFormat("th-TH", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE });

/**
 * "วันเสาร์ที่ 21 พฤศจิกายน 2569 เวลา 13:00–15:00 น.", always in Bangkok time
 * whatever zone the worker runs in. A range that crosses midnight names the
 * end's date as well.
 */
export function formatEventTime(startAt: number, endAt: number | null) {
  const start = `${dateFormat.format(startAt)} เวลา ${timeFormat.format(startAt)}`;
  if (endAt == null || endAt <= startAt) return `${start} น.`;
  if (dayKey.format(startAt) === dayKey.format(endAt))
    return `${start}–${timeFormat.format(endAt)} น.`;
  return `${start} น. ถึง ${dateFormat.format(endAt)} เวลา ${timeFormat.format(endAt)} น.`;
}
