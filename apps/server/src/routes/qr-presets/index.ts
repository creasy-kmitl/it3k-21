import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { PRESET_NAME_MAX, presetDesign, qrPreset } from "@it3k/db/schema/qr-preset";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireMember,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
// Presets follow the same rule as short links: every member saves them, and
// the owner, admins and Tech/Live edit them.
import {
  canCreateLinks as canCreatePresets,
  canEditLink as canEditPreset,
  stillLinkCreator as stillPresetCreator,
  stillLinkEditor as stillPresetEditor,
} from "../../policies/short-links";
import { idParam } from "../calendar/shared";

const name = z.string().trim().min(1).max(PRESET_NAME_MAX);

const createInput = z.strictObject({ name, design: presetDesign });
const updateInput = z
  .strictObject({ name: name.optional(), design: presetDesign.optional() })
  .refine((input) => input.name !== undefined || input.design !== undefined, "Nothing to update");

function selectPresets(db: Database) {
  return db
    .select({ preset: qrPreset, ownerName: user.name })
    .from(qrPreset)
    .leftJoin(user, eq(user.id, qrPreset.ownerId));
}

type PresetRow = Awaited<ReturnType<ReturnType<typeof selectPresets>["all"]>>[number];

function toPreset(row: PresetRow, actor: CurrentUser) {
  const { preset } = row;
  return {
    id: preset.id,
    name: preset.name,
    design: preset.design,
    owner: preset.ownerId ? { id: preset.ownerId, name: row.ownerName ?? "" } : null,
    updatedAt: preset.updatedAt.getTime(),
    canEdit: canEditPreset(actor, preset.ownerId),
  };
}

export type QrPreset = ReturnType<typeof toPreset>;

async function findPreset(db: Database, presetId: string, actor: CurrentUser) {
  const [row] = await selectPresets(db).where(eq(qrPreset.id, presetId));
  return row ? toPreset(row, actor) : null;
}

/** Runs a batch whose first statement is an abortUnless guard; false if it refused. */
async function guarded(run: () => Promise<unknown>) {
  try {
    await run();
    return true;
  } catch (error) {
    if (constraintError(error) === "stale") return false;
    throw error;
  }
}

export const createQrPresetRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireMember)

    .get("/", async (c) => {
      const rows = await selectPresets(c.var.db).orderBy(asc(qrPreset.name), asc(qrPreset.id));
      return c.json(
        {
          items: rows.map((row) => toPreset(row, c.var.user)),
          canCreate: canCreatePresets(c.var.user),
        },
        200,
      );
    })

    .post("/", validate("json", createInput), async (c) => {
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      if (!canCreatePresets(actor)) return c.json({ message: "Forbidden" }, 403);
      const presetId = crypto.randomUUID();
      const saved = await guarded(() =>
        db.batch([
          abortUnless(db, actor.id, stillPresetCreator()),
          db.insert(qrPreset).values({ id: presetId, ...input, ownerId: actor.id }),
        ]),
      );
      if (!saved) return c.json({ message: "Forbidden" }, 403);
      const preset = await findPreset(db, presetId, actor);
      if (!preset) throw new Error("Created preset is missing");
      return c.json(preset, 201);
    })

    .patch("/:id", validate("param", idParam), validate("json", updateInput), async (c) => {
      const { id: presetId } = c.req.valid("param");
      const input = c.req.valid("json");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db.select().from(qrPreset).where(eq(qrPreset.id, presetId));
      if (!current) return c.json({ message: "Preset not found" }, 404);
      if (!canEditPreset(actor, current.ownerId)) return c.json({ message: "Forbidden" }, 403);
      const saved = await guarded(() =>
        db.batch([
          abortUnless(db, actor.id, stillPresetEditor(current.ownerId)),
          db
            .update(qrPreset)
            .set({ ...input, updatedAt: new Date() })
            .where(eq(qrPreset.id, presetId)),
        ]),
      );
      if (!saved) return c.json({ message: "Forbidden" }, 403);
      const preset = await findPreset(db, presetId, actor);
      if (!preset) return c.json({ message: "Preset not found" }, 404);
      return c.json(preset, 200);
    })

    .delete("/:id", validate("param", idParam), async (c) => {
      const { id: presetId } = c.req.valid("param");
      const db = c.var.db;
      const actor = c.var.user;
      const [current] = await db.select().from(qrPreset).where(eq(qrPreset.id, presetId));
      if (!current) return c.json({ message: "Preset not found" }, 404);
      if (!canEditPreset(actor, current.ownerId)) return c.json({ message: "Forbidden" }, 403);
      const deleted = await guarded(() =>
        db.batch([
          abortUnless(db, actor.id, stillPresetEditor(current.ownerId)),
          db.delete(qrPreset).where(eq(qrPreset.id, presetId)),
        ]),
      );
      if (!deleted) return c.json({ message: "Forbidden" }, 403);
      return c.json({ ok: true }, 200);
    });

export type QrPresetRoutes = ReturnType<typeof createQrPresetRoutes>;
