import type { ProfileValues } from "@it3k/db/profile";
import { ApiError } from "./leadership";

export type SaveState = "saved" | "pending" | "saving" | "error" | "conflict";

/** Coalesce changes, serialize requests, and never send a stale revision. */
export class DraftSaver {
  private pending: ProfileValues | null = null;
  private attempt: { revision: number; values: ProfileValues } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private stopped = false;
  private conflict = false;
  revision: number;
  constructor(
    revision: number,
    private save: (revision: number, values: ProfileValues) => Promise<{ revision: number }>,
    private notify: (state: SaveState, error?: string) => void,
    private delay = 750,
  ) {
    this.revision = revision;
  }
  change(values: ProfileValues) {
    if (this.stopped || this.conflict) return;
    this.pending = { ...values };
    clearTimeout(this.timer);
    this.notify("pending");
    this.timer = setTimeout(() => {
      void this.flush().catch(() => undefined);
    }, this.delay);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.conflict) throw new Error("ข้อมูลเปลี่ยนแปลงแล้ว กรุณาโหลดใหม่");
    if (this.running) {
      await this.running;
      return this.flush();
    }
    if (this.stopped) return;
    if (!this.attempt) {
      if (!this.pending) return;
      this.attempt = { revision: this.revision, values: this.pending };
      this.pending = null;
    }
    // A failed request may already have committed. Retry its exact payload
    // first, then save newer edits using the acknowledged revision.
    const { revision, values } = this.attempt;
    this.notify("saving");
    const run = this.save(revision, values)
      .then(({ revision }) => {
        this.revision = revision;
        this.attempt = null;
        this.notify(this.pending ? "pending" : "saved");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status < 500 && error.status !== 408) {
          // A rejected payload did not commit and can be replaced by an edit.
          this.pending ??= values;
          this.attempt = null;
        }
        this.conflict = error instanceof ApiError && error.status === 409;
        this.notify(
          this.conflict ? "conflict" : "error",
          error instanceof Error ? error.message : "บันทึกไม่สำเร็จ",
        );
        throw error;
      });
    this.running = run;
    try {
      await run;
    } finally {
      this.running = null;
    }
    if (this.pending && !this.stopped) await this.flush();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending = null;
    this.attempt = null;
  }
}
