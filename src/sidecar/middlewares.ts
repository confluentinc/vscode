import * as vscode from "vscode";
import { Middleware, RequestContext, ResponseContext } from "../clients/sidecar";

import { ccloudAuthSessionInvalidated } from "../emitters";
import { Logger } from "../logging";
const logger = new Logger("sidecar.middlewares");

// only create this if enabled in SidecarHandle setup
let requestResponseOutputChannel: vscode.OutputChannel | undefined;
export function setDebugOutputChannel() {
  if (!requestResponseOutputChannel) {
    requestResponseOutputChannel = vscode.window.createOutputChannel(
      "Confluent (Ext->Sidecar Debug)",
    );
  }
}

function contextToRequestLogString(context: RequestContext): string {
  const logBody = {
    url: context.url,
    method: context.init.method as string,
    headers: sanitizeHeaders(context.init.headers),
    body: context.init.body ? String(context.init.body) : undefined,
  };
  return JSON.stringify(logBody);
}

async function contextToResponseLogString(context: ResponseContext): Promise<string> {
  let body: string;

  try {
    const contentType = context.response.headers.get("content-type");
    if (contentType && contentType.includes("application/json")) {
      body = JSON.stringify(await context.response.json());
    } else {
      body = await context.response.text();
    }
  } catch (e) {
    body = `error reading response body: ${e}`;
  }

  const logBody = {
    status: context.response.status,
    statusText: context.response.statusText,
    headers: sanitizeHeaders(context.response.headers),
    body: body,
  };
  return JSON.stringify(logBody);
}

/** Truncate the Authorization header value so it doesn't leak into any logs or {@link vscode.OutputChannel}s. */
function sanitizeHeaders(headers: HeadersInit | Headers | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  const sanitizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      sanitizedHeaders[key] = `Bearer ${value.slice(7, 9)}...${value.slice(-2)}`;
    } else {
      sanitizedHeaders[key] = value;
    }
  }
  return sanitizedHeaders;
}

export class DebugRequestResponseMiddleware implements Middleware {
  async pre(context: RequestContext): Promise<void> {
    const timestamp = new Date().toISOString();
    const requestLogString = contextToRequestLogString(context);

    const logPrefix = "sending request";
    logger.debug(logPrefix, { request: requestLogString });
    requestResponseOutputChannel?.appendLine(`${timestamp} | ${logPrefix}: ${requestLogString}`);
  }

  async post(context: ResponseContext): Promise<void> {
    const timestamp = new Date().toISOString();
    const requestLogString = contextToRequestLogString(context);
    const responseLogString = await contextToResponseLogString(context);

    const logPrefix = "received response";
    logger.debug(logPrefix, { request: requestLogString, response: responseLogString });
    requestResponseOutputChannel?.appendLine(`${timestamp} | ${logPrefix}`);
    requestResponseOutputChannel?.appendLine(`\trequest: ${requestLogString}`);
    requestResponseOutputChannel?.appendLine(`\tresponse: ${responseLogString}`);
  }
}

export class ErrorResponseMiddleware implements Middleware {
  async post(context: ResponseContext): Promise<void> {
    if (context.response.status >= 400) {
      const requestLogString = contextToRequestLogString(context);
      const responseLogString = await contextToResponseLogString(context);

      const logPrefix = "received error response from sidecar";
      logger.error(logPrefix, {
        request: requestLogString,
        response: responseLogString,
      });
      // don't throw an error because our openapi-generator client code will throw ResponseError by
      // default if status >= 400

      if (context.response.status === 401) {
        // inform the auth provider that the auth session is no longer valid
        ccloudAuthSessionInvalidated.fire();
      }
    }
  }
}
