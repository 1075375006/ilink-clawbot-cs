import type { SessionPayload } from "./util/crypto.js";

declare module "fastify" {
  interface FastifyRequest {
    admin?: SessionPayload;
  }
}
