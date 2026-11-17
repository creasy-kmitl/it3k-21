import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import type { EmailJob, Recipient } from "@it3k/email/jobs";
import { eq } from "drizzle-orm";
import type { Context } from "hono";
import type { CurrentUserEnv } from "../middleware/current-user";

/** Kept in sync with `EMAIL_FROM` in packages/infra/alchemy.run.ts (the binding's allow list). */
export const EMAIL_FROM = { email: "noreply@mail.creasy.club", name: "IT3Kings" } as const;

/** Puts emails on the queue; the server's `queue()` handler sends them. */
export type Mailer = { enqueue(jobs: EmailJob[]): Promise<void> };

export type MailDeps = { mailer: Mailer };

/** Cloudflare caps one `sendBatch` at 100 messages. */
const QUEUE_BATCH = 100;

export function createQueueMailer(queue: Queue<EmailJob>): Mailer {
  return {
    async enqueue(jobs) {
      for (let i = 0; i < jobs.length; i += QUEUE_BATCH) {
        await queue.sendBatch(
          jobs.slice(i, i + QUEUE_BATCH).map((body) => ({ body, contentType: "json" as const })),
        );
      }
    },
  };
}

/**
 * Queues transactional emails after the write that caused them has
 * committed. An email is a courtesy, not part of the change: if the queue is
 * unreachable the request still succeeds, and the failure is logged.
 */
export async function queueEmails(c: Context<CurrentUserEnv>, deps: MailDeps, jobs: EmailJob[]) {
  if (jobs.length === 0) return;
  try {
    await deps.mailer.enqueue(jobs);
  } catch (error) {
    c.var.log?.warn("email enqueue failed", {
      email: { kinds: jobs.map((job) => job.kind), error: String(error) },
    });
  }
}

/** The account's address and display name, for addressing an email to it. */
export async function recipientOf(db: Database, userId: string): Promise<Recipient | null> {
  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, userId));
  return row ? { email: row.email, name: row.name || null } : null;
}
