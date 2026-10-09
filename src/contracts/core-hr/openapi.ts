import { z } from "zod";
import { operations, type Operation } from "./operations";
import { schemaRegistry } from "./schemas";

type JsonObject = Record<string, unknown>;

function componentRef(schema: z.ZodType): JsonObject {
  const meta = schemaRegistry.get(schema);
  if (meta?.id) return { $ref: `#/components/schemas/${meta.id}` };
  return stripMeta(z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as JsonObject);
}

function stripMeta(s: JsonObject): JsonObject {
  const { $schema: _a, $id: _b, ...rest } = s;
  void _a;
  void _b;
  return rest;
}

function parametersFrom(schema: z.ZodType | undefined, location: "query" | "path"): JsonObject[] {
  if (!schema) return [];
  const js = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as {
    properties?: Record<string, JsonObject>;
    required?: string[];
  };
  return Object.entries(js.properties ?? {}).map(([name, propSchema]) => ({
    name,
    in: location,
    required: location === "path" ? true : (js.required ?? []).includes(name),
    schema: propSchema,
  }));
}

const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: "Malformed request or a field that is not allowed",
  401: "Missing or invalid token (signature, issuer, audience, tenant, expiry or scope)",
  403: "Authenticated but not permitted, or no HRMS account",
  404: "Not found",
  409: "Conflict: duplicate code, work email already assigned, or Idempotency-Key reused with a different payload",
  422: "Business rule violation, operational profile incomplete, or a protected field that is not enabled",
  503: "Service unavailable",
};

function operationObject(op: Operation): JsonObject {
  const parameters = [...parametersFrom(op.pathParams, "path"), ...parametersFrom(op.query, "query")];
  if (op.idempotencyKey) {
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      description: "8-128 characters, unique per caller and operation.",
      schema: { type: "string", minLength: 8, maxLength: 128 },
    });
  }
  const responses: JsonObject = {
    [String(op.success.status)]: {
      description: op.success.description,
      content: { "application/json": { schema: componentRef(op.success.schema) } },
    },
  };
  for (const status of op.errors) {
    responses[String(status)] = {
      description: ERROR_DESCRIPTIONS[status] ?? "Error",
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
    };
  }
  const permissionNote = op.permission ? `\n\nRequired permission: \`${op.permission}\`.` : "";
  return {
    operationId: op.operationId,
    summary: op.summary,
    description: `${op.description ?? ""}${permissionNote}`.trim() || undefined,
    tags: [op.tag],
    security: op.auth ? [{ bearerAuth: [] }] : [],
    ...(parameters.length ? { parameters } : {}),
    ...(op.body
      ? { requestBody: { required: true, content: { "application/json": { schema: componentRef(op.body) } } } }
      : {}),
    responses,
  };
}

export function buildOpenApiDocument(): JsonObject {
  const generated = z.toJSONSchema(schemaRegistry, {
    target: "draft-2020-12",
    io: "output",
    uri: (id) => `#/components/schemas/${id}`,
  }) as { schemas: Record<string, JsonObject> };
  const schemas: Record<string, JsonObject> = {};
  for (const [id, s] of Object.entries(generated.schemas)) schemas[id] = stripMeta(s);

  const paths: Record<string, JsonObject> = {};
  for (const op of Object.values(operations) as Operation[]) {
    paths[op.path] ??= {};
    paths[op.path][op.method] = operationObject(op);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "EmeSoft Core HR API (internal)",
      version: "0.1.0",
      description:
        "Core HR phase 1: implemented operations only (S0-S3). Example data is synthetic. Planned work: docs/core-hr-spec.md.",
    },
    servers: [{ url: "/", description: "Same origin (local/test)" }],
    tags: [
      { name: "System" },
      { name: "Identity" },
      { name: "Employees" },
      { name: "Employments" },
      { name: "Catalogs" },
      { name: "Docs" },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description:
            "Access token issued for the HRMS API registration (scope access_as_user). Microsoft Entra ID once IT provides the registration; the development test issuer works only in local/test. ID tokens, Graph tokens and hrx_ keys are not accepted.",
        },
      },
      schemas,
    },
  };
}
