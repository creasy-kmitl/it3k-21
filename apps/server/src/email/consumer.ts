import type { Database } from "@it3k/db";
import { emailCampaign } from "@it3k/db/schema/email";
import type { CustomJob, EmailJob, Recipient } from "@it3k/email/jobs";
import {
  type EmailContext,
  type InlineAttachment,
  renderEmail,
  type RenderedEmail,
} from "@it3k/email/render";
import { richTextDocSchema } from "@it3k/email/rich-text";
import { eq, sql } from "drizzle-orm";

import { EMAIL_FROM } from "./mailer";

/** One outgoing message, in the shape the `send_email` binding takes. */
export type OutgoingEmail = {
  from: { email: string; name: string };
  to: string | { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  attachments?: InlineAttachment[];
};

export type EmailLog = {
  info(message: string, fields: Record<string, unknown>): void;
  warn(message: string, fields: Record<string, unknown>): void;
};

export type ConsumerDeps = {
  getDb: () => Database;
  ctx: EmailContext;
  send: (message: OutgoingEmail) => Promise<unknown>;
  /** Puts a staff-email chunk back on the queue with the people still waiting. */
  requeue: (job: CustomJob, delaySeconds: number) => Promise<void>;
  log: EmailLog;
};

/** The parts of a queue message the handler uses, so tests can fake one. */
export type JobMessage = {
  body: EmailJob;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

/** After this many returns, whoever is left in a staff-email chunk counts as failed. */
export const MAX_ATTEMPTS = 5;

/**
 * Codes the binding throws that are worth another try later. Anything else
 * with a code (suppressed or invalid recipient, refused content, …) will fail
 * the same way again. An error without a code is treated as transient.
 */
const TRANSIENT = new Set([
  "E_RATE_LIMIT_EXCEEDED",
  "E_DAILY_LIMIT_EXCEEDED",
  "E_INTERNAL_SERVER_ERROR",
]);

function errorCode(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

export function isTransient(error: unknown) {
  const code = errorCode(error);
  return code === null || TRANSIENT.has(code);
}

/** Seconds to wait before the next try: an hour for the daily quota, otherwise growing from 30 s. */
export function retryDelay(error: unknown, attempts: number) {
  if (errorCode(error) === "E_DAILY_LIMIT_EXCEEDED") return 60 * 60;
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 15 * 60);
}

const address = (to: Recipient) => (to.name ? { email: to.email, name: to.name } : to.email);

function outgoing(to: Recipient, rendered: RenderedEmail): OutgoingEmail {
  return { from: { ...EMAIL_FROM }, to: address(to), ...rendered };
}

async function sendCustom(job: CustomJob, deps: ConsumerDeps) {
  const db = deps.getDb();
  const [campaign] = await db
    .select({
      subject: emailCampaign.subject,
      content: emailCampaign.content,
      senderName: emailCampaign.senderName,
    })
    .from(emailCampaign)
    .where(eq(emailCampaign.id, job.campaignId));
  if (!campaign) {
    deps.log.warn("email campaign missing", { email: { campaignId: job.campaignId } });
    return;
  }
  const content = richTextDocSchema.safeParse(campaign.content);
  let sent = 0;
  let failed = 0;
  let waiting: Recipient[] = [];
  let transient: unknown = null;

  if (!content.success) {
    failed = job.to.length;
  } else {
    // The body is the same for everyone, so it is rendered once per chunk.
    const rendered = await renderEmail(
      {
        kind: "custom",
        to: job.to[0] ?? { email: "" },
        subject: campaign.subject,
        content: content.data,
        sender: campaign.senderName,
      },
      deps.ctx,
    );
    for (const [index, to] of job.to.entries()) {
      try {
        await deps.send(outgoing(to, rendered));
        sent++;
      } catch (error) {
        if (isTransient(error)) {
          // Stop here: the rest would most likely hit the same limit.
          waiting = job.to.slice(index);
          transient = error;
          break;
        }
        failed++;
        deps.log.warn("email recipient failed", {
          email: { campaignId: job.campaignId, code: errorCode(error) },
        });
      }
    }
  }

  const attempt = (job.attempt ?? 0) + 1;
  if (waiting.length && attempt >= MAX_ATTEMPTS) {
    failed += waiting.length;
    deps.log.warn("email chunk gave up", {
      email: { campaignId: job.campaignId, left: waiting.length, code: errorCode(transient) },
    });
    waiting = [];
  }
  if (sent || failed) {
    await db
      .update(emailCampaign)
      .set({
        sentCount: sql`${emailCampaign.sentCount} + ${sent}`,
        failedCount: sql`${emailCampaign.failedCount} + ${failed}`,
      })
      .where(eq(emailCampaign.id, job.campaignId));
  }
  if (waiting.length) {
    await deps.requeue({ ...job, to: waiting, attempt }, retryDelay(transient, attempt));
  }
}

/** Renders and sends one transactional email; throws what the binding throws. */
async function sendTransactional(job: Exclude<EmailJob, CustomJob>, deps: ConsumerDeps) {
  const rendered = await renderEmail(job, deps.ctx);
  await deps.send(outgoing(job.to, rendered));
}

/**
 * The queue consumer. Each message is acknowledged on its own, so one bad
 * email never sends the rest of the batch round again.
 */
export async function handleEmailBatch(messages: readonly JobMessage[], deps: ConsumerDeps) {
  for (const message of messages) {
    const job = message.body;
    try {
      if (job.kind === "custom") await sendCustom(job, deps);
      else await sendTransactional(job, deps);
      message.ack();
    } catch (error) {
      // A staff-email chunk only throws before it sent anything (loading or
      // rendering), so retrying the whole message is safe for both kinds.
      if (isTransient(error) && message.attempts < MAX_ATTEMPTS) {
        message.retry({ delaySeconds: retryDelay(error, message.attempts) });
      } else {
        message.ack();
        deps.log.warn("email dropped", {
          email: {
            kind: job.kind,
            attempts: message.attempts,
            code: errorCode(error),
            error: String(error),
          },
        });
      }
    }
  }
}
