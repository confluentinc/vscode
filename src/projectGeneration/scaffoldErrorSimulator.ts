import { ResponseError } from "../clients/sidecar";

/** Enumeration of mockable scaffold error scenarios. */
export enum ScaffoldErrorScenario {
  None = "none",
  Network = "network",
  Timeout = "timeout",
  ForbiddenProxy = "forbidden-proxy",
  Validation422 = "validation-422",
  RateLimit429 = "rate-limit-429",
  Internal500 = "internal-500",
  MalformedJson = "malformed-json",
  EmptyBody = "empty-body",
  ArchiveBufferFailure = "archive-buffer-failure",
}

/** Current scenario (set via command, env var, or test). */
let currentScenario: ScaffoldErrorScenario = ScaffoldErrorScenario.None;

/** Set the active scaffold error scenario. */
export function setScaffoldErrorScenario(scenario: ScaffoldErrorScenario): void {
  currentScenario = scenario;
}

/** Get the active scaffold error scenario (no env override; caller may supply scenario directly). */
export function getScaffoldErrorScenario(): ScaffoldErrorScenario {
  return currentScenario;
}

/** Union type for all synthetic scaffold errors (or absence). */
export type ScaffoldSyntheticError = ResponseError | Error | undefined;

/**
 * Factory for synthetic ResponseError/Error matching expected parsing paths.
 * If a scenario is provided it is used; otherwise the current global scenario.
 */
export function makeScenarioError(scenario?: ScaffoldErrorScenario): ScaffoldSyntheticError {
  const active = scenario ?? getScaffoldErrorScenario();
  switch (active) {
    case ScaffoldErrorScenario.Network:
      return new Error("Network unreachable (simulated).");
    case ScaffoldErrorScenario.Timeout:
      return new Error("Request timed out after 30s (simulated).");
    case ScaffoldErrorScenario.ForbiddenProxy:
      return new ResponseError(
        new Response(
          JSON.stringify({
            errors: [
              {
                detail: "Access denied. A corporate proxy or VPN may be blocking the request.",
                source: { pointer: "/options" },
              },
            ],
          }),
          { status: 403, statusText: "Forbidden" },
        ),
      );
    case ScaffoldErrorScenario.Validation422:
      return new ResponseError(
        new Response(
          JSON.stringify({
            errors: [
              {
                detail: "Must be a valid Java package name.",
                source: { pointer: "/options/package_name" },
              },
              { detail: "Length must be <= 32.", source: { pointer: "/options/app_id" } },
            ],
          }),
          { status: 422, statusText: "Unprocessable Entity" },
        ),
      );
    case ScaffoldErrorScenario.RateLimit429:
      return new ResponseError(
        new Response(
          JSON.stringify({
            errors: [
              {
                detail: "Rate limit exceeded. Retry after 60 seconds.",
                source: { pointer: "/options" },
              },
            ],
          }),
          { status: 429, statusText: "Too Many Requests" },
        ),
      );
    case ScaffoldErrorScenario.Internal500:
      return new ResponseError(
        new Response(
          JSON.stringify({
            errors: [
              {
                detail: "Internal scaffolding service error. Please retry later.",
                source: { pointer: "/options" },
              },
            ],
          }),
          { status: 500, statusText: "Internal Server Error" },
        ),
      );
    case ScaffoldErrorScenario.MalformedJson:
      return new ResponseError(
        new Response("{ not: valid", { status: 500, statusText: "Internal Server Error" }),
      );
    case ScaffoldErrorScenario.EmptyBody:
      return new ResponseError(new Response("", { status: 502, statusText: "Bad Gateway" }));
    case ScaffoldErrorScenario.ArchiveBufferFailure:
      return new Error("Failed while buffering archive (simulated).");
    case ScaffoldErrorScenario.None:
    default:
      return undefined;
  }
}

/**
 * Optionally inject a scaffold error for a provided scenario (preferred),
 * or fall back to the globally set scenario. Returns undefined if scenario is None.
 */
export function maybeInjectScaffoldError(scenario?: ScaffoldErrorScenario): ScaffoldSyntheticError {
  const active = scenario ?? getScaffoldErrorScenario();
  if (active === ScaffoldErrorScenario.None) return undefined;
  return makeScenarioError(active);
}
// From error output log
const sampleResp = {
  responseStatus: 422,
  responseStatusText: "Unprocessable Entity",
  responseBody:
    '{\n  "errors": [\n    {\n      "id": "b7c2d694fbc4606bbdd034be89ba15f7",\n      "status": "422",\n      "detail": "Option \'max_batch_size\' must match pattern ^[0-9]+$",\n      "source": {\n        "pointer": "/options/max_batch_size"\n      }\n    },\n    {\n      "id": "b7c2d694fbc4606bbdd034be89ba15f7",\n      "status": "422",\n      "detail": "Option \'max_batching_window\' must match pattern ^[0-9]+$",\n      "source": {\n        "pointer": "/options/max_batching_window"\n      }\n    }\n  ]\n}',
  responseErrorType: "ResponseError",
  extra: {
    templateName: "nodejs-aws-lambda-consumer",
    failureStage: "scaffold service apply operation",
  },
};
