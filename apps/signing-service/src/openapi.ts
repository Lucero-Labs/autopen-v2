/**
 * The product API as an OpenAPI 3.0 document, built once from the schemas in
 * `wire.ts` and served at `GET /openapi.json`, so a product, or the assistant
 * writing it, reads the contract from the running service.
 *
 * Only the routes a product calls are here. The signing page's routes are
 * authenticated by the link token and consumed by our own page, and the
 * webhook is the authority's; neither is a contract a product reads.
 */

import { z } from "zod";

import {
  createInstrumentRequest,
  eligibilityRequest,
  eligibilityResponse,
  errorResponse,
  healthResponse,
  instrumentResponse,
} from "./wire.ts";

/** A schema under `components.schemas`, by the name a `$ref` uses. */
type SchemaName =
  | "CreateInstrumentRequest"
  | "EligibilityRequest"
  | "InstrumentResponse"
  | "EligibilityResponse"
  | "HealthResponse"
  | "ErrorResponse";

/** One answer a route can give: a JSON body by schema name, a PDF, or nothing. */
interface Answer {
  readonly status: number;
  readonly description: string;
  readonly body?: SchemaName | "pdf";
}

/** One product route, as much as the document needs to describe it. */
interface Route {
  readonly method: "get" | "post";
  readonly path: string;
  readonly summary: string;
  readonly description?: string;
  readonly secured: boolean;
  readonly request?: SchemaName;
  readonly answers: readonly Answer[];
}

/** The JSON Schema zod emits; opaque here, `$ref`s point into it. */
type JsonSchema = Record<string, unknown>;

/** The document, typed as far as this module writes it. */
export interface OpenApiDocument {
  readonly openapi: "3.0.3";
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly security: readonly Record<string, readonly never[]>[];
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly schemas: Record<SchemaName, JsonSchema>;
    readonly securitySchemes: Record<string, unknown>;
  };
}

/** Bumped when a product would have to change its client, not on every edit. */
const API_VERSION = "1.0.0";

const REFUSED: Answer = {
  status: 400,
  description: "The body is refused; `error` says which field and why.",
  body: "ErrorResponse",
};
const UNAUTHORIZED: Answer = {
  status: 401,
  description: "No key, or the wrong one.",
  body: "ErrorResponse",
};
const NO_INSTRUMENT: Answer = {
  status: 404,
  description: "No instrument with that id.",
  body: "ErrorResponse",
};
const FAILED: Answer = {
  status: 500,
  description:
    "The service or the authority failed; `correlationId` is what their support can trace.",
  body: "ErrorResponse",
};

const ROUTES: readonly Route[] = [
  {
    method: "get",
    path: "/health",
    summary: "Whether the process is up, and whether its database host answers.",
    secured: false,
    answers: [{ status: 200, description: "Up.", body: "HealthResponse" }],
  },
  {
    method: "post",
    path: "/api/eligibility",
    summary: "Whether the signer already holds a certificate.",
    description:
      "Free: no session, nothing consumed. Ask before writing the mail, with the reference the instrument will carry. The authority binds that reference to the first email it sees it with, permanently.",
    secured: true,
    request: "EligibilityRequest",
    answers: [
      { status: 200, description: "The authority's answer.", body: "EligibilityResponse" },
      REFUSED,
      UNAUTHORIZED,
      FAILED,
    ],
  },
  {
    method: "post",
    path: "/api/instruments",
    summary: "Seal a PDF for one signer and mint the signing link.",
    description:
      "An instrument's identity is its reference, its bytes and its signer. A corrected document is a new reference, never an edit.",
    secured: true,
    request: "CreateInstrumentRequest",
    answers: [
      { status: 201, description: "Created.", body: "InstrumentResponse" },
      {
        status: 200,
        description:
          "The same reference, bytes and signer already exist: the existing instrument, same link.",
        body: "InstrumentResponse",
      },
      REFUSED,
      UNAUTHORIZED,
      {
        status: 409,
        description: "The reference already names a different document or a different signer.",
        body: "ErrorResponse",
      },
      {
        status: 413,
        description: "The PDF decodes to more than the authority accepts.",
        body: "ErrorResponse",
      },
      FAILED,
    ],
  },
  {
    method: "get",
    path: "/api/instruments/{instrumentId}",
    summary: "The instrument, with its state. Poll it.",
    description:
      "`signed` means the service holds a copy verified against the authority's record; nothing the signer's browser says can set it.",
    secured: true,
    answers: [
      { status: 200, description: "The instrument.", body: "InstrumentResponse" },
      UNAUTHORIZED,
      NO_INSTRUMENT,
    ],
  },
  {
    method: "get",
    path: "/api/instruments/{instrumentId}/document",
    summary: "The unsigned PDF, as sent.",
    secured: true,
    answers: [
      { status: 200, description: "The sealed PDF.", body: "pdf" },
      UNAUTHORIZED,
      NO_INSTRUMENT,
    ],
  },
  {
    method: "get",
    path: "/api/instruments/{instrumentId}/artifact",
    summary: "The signed PDF, once the instrument is `signed`.",
    secured: true,
    answers: [
      {
        status: 200,
        description: "The signed PDF, verified against the authority's record.",
        body: "pdf",
      },
      UNAUTHORIZED,
      { status: 404, description: "No such instrument, or not signed yet.", body: "ErrorResponse" },
    ],
  },
];

/** `components.schemas`: requests as the service reads them, responses as it writes them. */
function schemas(): Record<SchemaName, JsonSchema> {
  const request = (schema: z.ZodType): JsonSchema =>
    z.toJSONSchema(schema, { target: "openapi-3.0", io: "input" });
  const response = (schema: z.ZodType): JsonSchema =>
    z.toJSONSchema(schema, { target: "openapi-3.0" });
  return {
    CreateInstrumentRequest: request(createInstrumentRequest),
    EligibilityRequest: request(eligibilityRequest),
    InstrumentResponse: response(instrumentResponse),
    EligibilityResponse: response(eligibilityResponse),
    HealthResponse: response(healthResponse),
    ErrorResponse: response(errorResponse),
  };
}

function content(body: SchemaName | "pdf"): Record<string, unknown> {
  return body === "pdf"
    ? { "application/pdf": { schema: { type: "string", format: "binary" } } }
    : { "application/json": { schema: { $ref: `#/components/schemas/${body}` } } };
}

function operation(route: Route): Record<string, unknown> {
  const parameters = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, name]) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }));
  const responses: Record<string, unknown> = {};
  for (const answer of route.answers) {
    responses[String(answer.status)] = {
      description: answer.description,
      ...(answer.body !== undefined ? { content: content(answer.body) } : {}),
    };
  }
  return {
    summary: route.summary,
    ...(route.description !== undefined ? { description: route.description } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(route.request !== undefined
      ? { requestBody: { required: true, content: content(route.request) } }
      : {}),
    responses,
    // An unsecured route says so explicitly; the document's default is the key.
    ...(route.secured ? {} : { security: [] }),
  };
}

function build(): OpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of ROUTES) {
    paths[route.path] = { ...paths[route.path], [route.method]: operation(route) };
  }
  return {
    openapi: "3.0.3",
    info: {
      title: "autopen signing service",
      version: API_VERSION,
      description:
        "Seal a PDF, hand the signer a link, collect the signed file. Bodies are JSON; files travel as base64. Routes match exactly: a GET on a POST route, or a trailing slash, is 404.",
    },
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      schemas: schemas(),
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "AUTOPEN_API_KEY. A backend secret: never in a browser, a URL or a log.",
        },
      },
    },
  };
}

/** The document, built once; the route serves it as-is. */
export const OPENAPI_DOCUMENT: OpenApiDocument = Object.freeze(build());
