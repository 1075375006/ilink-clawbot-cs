import type { SessionPayload } from "./util/crypto.js";
import type { serializeAgent } from "./services/support-agents.js";

declare module "fastify" {
  interface FastifyRequest {
    admin?: SessionPayload;
    supportAgent?: ReturnType<typeof serializeAgent>;
  }
}
