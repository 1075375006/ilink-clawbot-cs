import cron from "node-cron";
import type { ScheduledTask } from "node-cron";
import { env } from "./env.js";
import { expireStaleSessions } from "./services/binding.js";
import { runKeepalive } from "./services/keepalive.js";

let task: ScheduledTask | null = null;
let expiryTask: ScheduledTask | null = null;

export function startScheduler(): void {
  if (task) return;
  task = cron.schedule(env.keepaliveCron, async () => {
    try {
      const result = await runKeepalive();
      if (result.sent || result.failed || result.deferred) {
        console.log(
          `[keepalive] checked=${result.checked} eligible=${result.eligible} sent=${result.sent} failed=${result.failed} deferred=${result.deferred}`,
        );
      }
    } catch (error) {
      console.error("[keepalive] scheduled run failed:", error);
    }
  });
  expiryTask = cron.schedule("*/5 * * * *", () => {
    try {
      expireStaleSessions();
    } catch (error) {
      console.error("[binding] expiry sweep failed:", error);
    }
  });
  console.log(`[scheduler] keepalive cron: ${env.keepaliveCron}`);
}

export function stopScheduler(): void {
  task?.stop();
  expiryTask?.stop();
  task = null;
  expiryTask = null;
}
