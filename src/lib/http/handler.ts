import { z } from "zod";
import type { Operation } from "@/contracts/core-hr/operations";
import { recordAudit } from "@/modules/audit/audit";
import { authenticate, type Principal } from "@/modules/identity/authenticate";
import { ApiError, forbidden, validationError, type ErrorDetail } from "./errors";

type Ctx<Op extends Operation> = {
  req: Request;
  requestId: string;
  principal: Op["auth"] extends true ? Principal : Principal | null;
  params: Op["pathParams"] extends z.ZodType ? z.output<Op["pathParams"]> : Record<string, never>;
  query: Op["query"] extends z.ZodType ? z.output<Op["query"]> : Record<string, never>;
  body: Op["body"] extends z.ZodType ? z.output<Op["body"]> : undefined;
  rawBody: unknown;
};

export type HandlerResult = { status?: number; body: unknown; headers?: Record<string, string> };

const BASE_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function zodDetails(error: z.ZodError, prefix: string): ErrorDetail[] {
  return error.issues.map((i) => ({
    field: [prefix, ...i.path.map(String)].filter(Boolean).join("."),
    code: i.code === "unrecognized_keys" ? "FIELD_NOT_ALLOWED" : "INVALID",
    message:
      i.code === "unrecognized_keys"
        ? `Field not allowed: ${(i as { keys: string[] }).keys.join(", ")}`
        : i.message,
  }));
}

function parseWith<T extends z.ZodType>(schema: T, value: unknown, prefix: string): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw validationError(zodDetails(result.error, prefix));
  return result.data;
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    const headers: Record<string, string> = { ...BASE_HEADERS, "X-Request-Id": requestId };
    if (error.status === 401) headers["WWW-Authenticate"] = 'Bearer error="invalid_token"';
    return new Response(
      JSON.stringify({
        error: error.code,
        message: error.message,
        request_id: requestId,
        ...(error.details?.length ? { details: error.details } : {}),
        ...(error.extra ?? {}),
      }),
      { status: error.status, headers },
    );
  }
  // Log only an error identifier: never payloads, tokens or messages that may contain data.
  const name = error instanceof Error ? error.name : typeof error;
  console.error(JSON.stringify({ level: "error", request_id: requestId, error: "INTERNAL_ERROR", type: name }));
  return new Response(
    JSON.stringify({ error: "INTERNAL_ERROR", message: "Internal error.", request_id: requestId }),
    { status: 500, headers: { ...BASE_HEADERS, "X-Request-Id": requestId } },
  );
}

export function defineHandler<Op extends Operation>(
  op: Op,
  fn: (ctx: Ctx<Op>) => Promise<HandlerResult>,
  options: { preValidateBody?: (raw: unknown) => void } = {},
) {
  return async (req: Request, routeCtx?: { params?: Promise<Record<string, string>> }) => {
    const requestId = crypto.randomUUID();
    try {
      let principal: Principal | null = null;
      if (op.auth) {
        principal = await authenticate(req);
        if (op.permission && !principal.permissions.has(op.permission)) {
          await recordAudit({
            actorUserId: principal.userId,
            action: op.operationId,
            outcome: "denied",
            entityType: "operation",
            requestId,
          });
          throw forbidden();
        }
      }
      const rawParams = (await routeCtx?.params) ?? {};
      const params = op.pathParams ? parseWith(op.pathParams, rawParams, "path") : {};
      const url = new URL(req.url);
      const query = op.query ? parseWith(op.query, Object.fromEntries(url.searchParams), "query") : {};
      let rawBody: unknown = undefined;
      let body: unknown = undefined;
      if (op.body) {
        const text = await req.text();
        try {
          rawBody = text ? JSON.parse(text) : undefined;
        } catch {
          throw validationError([{ code: "INVALID_JSON", message: "Request body is not valid JSON." }]);
        }
        options.preValidateBody?.(rawBody);
        body = parseWith(op.body, rawBody, "");
      }
      const result = await fn({ req, requestId, principal, params, query, body, rawBody } as Ctx<Op>);
      return new Response(JSON.stringify(result.body), {
        status: result.status ?? op.success.status,
        headers: { ...BASE_HEADERS, "X-Request-Id": requestId, ...(result.headers ?? {}) },
      });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}
