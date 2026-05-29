/**
 * OpenAPI 3.1 spec for the Stride API, served at GET /openapi.json.
 *
 * Source of truth for the generated web TS client and the future iOS Swift
 * client (apple/swift-openapi-generator). Kept in lock-step with the routes in
 * src/routes/* and the Zod shapes in @stride/shared-types. The error envelope
 * and the v1 surface are stable; response bodies reference the shared schemas
 * conceptually (full per-field component schemas are added as clients need
 * them — today the web client is hand-thin and iOS is documented).
 */

const errorResponse = {
  description: "Error envelope",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" },
    },
  },
};

const dateQuery = {
  name: "date",
  in: "query",
  required: false,
  schema: { type: "string", format: "date" },
  description: "YYYY-MM-DD (UTC). Defaults to today.",
};

function metricPath(summary: string) {
  return {
    get: {
      summary,
      parameters: [dateQuery],
      responses: {
        "200": { description: "Computed metric (shape per @stride/shared-types)" },
        "401": errorResponse,
        "422": errorResponse,
        "429": errorResponse,
      },
    },
  };
}

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Stride API",
    version: "1.0.0",
    description:
      "Self-hosted WHOOP-style health platform API. Consumed by the web app " +
      "and the (planned) iOS app. Auth: opaque session token via httpOnly " +
      "cookie (web) or Authorization: Bearer (iOS).",
  },
  servers: [{ url: "/api", description: "Behind Caddy on the LAN" }],
  paths: {
    "/healthz": {
      get: {
        summary: "Liveness probe",
        responses: { "200": { description: "ok" } },
      },
    },
    "/v1/auth/login": {
      post: {
        summary: "Log in with KS Fit credentials; mints a session",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "ok" }, "400": errorResponse, "401": errorResponse },
      },
    },
    "/v1/auth/logout": {
      post: { summary: "Clear the session", responses: { "200": { description: "ok" } } },
    },
    "/v1/metrics/recovery": metricPath("Recovery score (Stride estimate, 0–100)"),
    "/v1/metrics/strain": metricPath("Day Strain (0–21)"),
    "/v1/metrics/sleep": metricPath("Sleep performance, need, debt, recommendations"),
    "/v1/metrics/stress": metricPath("Stress (HR-based estimate)"),
    "/v1/metrics/fitness-age": metricPath("Fitness Age (cardiorespiratory)"),
    "/v1/metrics/hrv": {
      get: {
        summary: "HRV baseline + personal target band + trend",
        parameters: [dateQuery, { name: "days", in: "query", schema: { type: "integer" } }],
        responses: { "200": { description: "HRV trend" }, "401": errorResponse },
      },
    },
    "/v1/metrics/daily-activity": metricPath("Daily steps/distance/active-minutes/calories"),
    "/v1/exercises": {
      get: {
        summary: "Detected + manual workouts for a day",
        parameters: [dateQuery],
        responses: { "200": { description: "Exercise list" }, "401": errorResponse },
      },
    },
    "/v1/exercises/{id}": {
      get: {
        summary: "One workout's detail incl. HR zones",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          dateQuery,
        ],
        responses: { "200": { description: "Exercise detail" }, "404": errorResponse },
      },
    },
    "/v1/profile": {
      get: { summary: "User profile", responses: { "200": { description: "Profile" }, "401": errorResponse } },
    },
    "/v1/coach/chat": {
      post: {
        summary: "AI coach chat (streamed)",
        description: "Streams a UI-message stream (text/event-stream). Grounded in the user's metrics; never invents numbers.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["messages"],
                properties: { messages: { type: "array", items: { type: "object" } } },
              },
            },
          },
        },
        responses: { "200": { description: "Streamed response" }, "503": errorResponse },
      },
    },
    "/v1/fitbit/connect": {
      get: { summary: "Start Fitbit OAuth (redirect)", responses: { "302": { description: "Redirect to Fitbit" }, "503": errorResponse } },
    },
    "/v1/fitbit/disconnect": {
      post: { summary: "Forget Fitbit tokens", responses: { "200": { description: "ok" } } },
    },
    "/v1/fitbit/log": {
      post: {
        summary: "Push a WalkingPad session to Fitbit",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["runId"], properties: { runId: { type: "string" } } },
            },
          },
        },
        responses: { "200": { description: "Logged" }, "401": errorResponse, "429": errorResponse },
      },
    },
    "/v1/export/sessions.csv": {
      get: { summary: "All sessions as CSV", responses: { "200": { description: "text/csv" } } },
    },
    "/v1/export/weight.csv": {
      get: { summary: "Weight log as CSV", responses: { "200": { description: "text/csv" } } },
    },
    "/v1/export/points/{runId}": {
      get: {
        summary: "Per-session telemetry as CSV",
        parameters: [{ name: "runId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "text/csv" } },
      },
    },
  },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { type: "object" },
              requestId: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;
