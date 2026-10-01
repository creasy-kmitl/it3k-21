import z from "zod";

/** A search param that is dropped, rather than failing the page, when it is malformed. */
export const optional = <T extends z.ZodType>(schema: T) => schema.optional().catch(undefined);

/** The URL filters of a paged list: search text, one department, and the page. */
export const listSearchSchema = z.object({
  q: optional(z.string().max(64)),
  department: optional(z.string().max(64)),
  page: optional(z.number().int().min(2)),
});

export type ListFilters = z.output<typeof listSearchSchema>;

/** Moving between pages adds history, so Back returns to the previous page; other filters replace. */
export function replacesHistory(patch: object) {
  return !("page" in patch && Object.keys(patch).length === 1);
}
