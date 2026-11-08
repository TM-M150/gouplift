export const DAY_MS = 24 * 60 * 60 * 1000;
export const EAT_OFFSET_MS = 3 * 60 * 60 * 1000; // Kenya is UTC+3, no DST

/** Start of the current East Africa day, as a UTC timestamp. Stable all day. */
export function startOfTodayEat(nowMs: number) {
  return Math.floor((nowMs + EAT_OFFSET_MS) / DAY_MS) * DAY_MS - EAT_OFFSET_MS;
}
