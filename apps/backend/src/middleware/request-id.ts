import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";

/** Attach a request id for log correlation and echo it on responses. */
export const requestId: MiddlewareHandler = async (c, next) => {
  const id = c.req.header("x-request-id") ?? randomUUID();
  c.set("requestId", id);
  c.header("X-Request-Id", id);
  c.header("X-Stride-API", "1");
  await next();
};
