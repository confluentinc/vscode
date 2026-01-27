/**
 * Flink LSP Authentication Handler.
 *
 * Handles the authentication handshake with CCloud Flink Language Service:
 * - Sends auth message after WebSocket connection
 * - Replaces token placeholders in outgoing LSP messages
 */

import type { WebSocket } from "ws";
import { Logger } from "../logging";

const logger = new Logger("flinkSql.flinkLspAuth");

/**
 * Token placeholder used by the language server client.
 * The sidecar previously replaced this placeholder with the actual token.
 */
export const DATA_PLANE_TOKEN_PLACEHOLDER = "{{ ccloud.data_plane_token }}";

/**
 * Authentication message structure for CCloud Flink LSP.
 * This message is sent immediately after WebSocket connection.
 */
export interface FlinkLspAuthMessage {
  /** Bearer token for authentication. */
  Token: string;
  /** Environment ID. */
  EnvironmentId: string;
  /** Organization ID. */
  OrganizationId: string;
}

/**
 * Parameters for Flink LSP connection.
 */
export interface FlinkLspConnectionParams {
  /** Cloud region (e.g., "us-west-2"). */
  region: string;
  /** Cloud provider (e.g., "aws"). */
  provider: string;
  /** Environment ID. */
  environmentId: string;
  /** Organization ID. */
  organizationId: string;
}

/**
 * Token provider function type.
 * Returns a promise that resolves to the data plane token.
 */
export type TokenProvider = () => Promise<string | null>;

/**
 * Creates the authentication message for CCloud Flink LSP.
 * @param token The data plane bearer token.
 * @param environmentId The environment ID.
 * @param organizationId The organization ID.
 * @returns The authentication message object.
 */
export function createAuthMessage(
  token: string,
  environmentId: string,
  organizationId: string,
): FlinkLspAuthMessage {
  return {
    Token: token,
    EnvironmentId: environmentId,
    OrganizationId: organizationId,
  };
}

/**
 * Sends the authentication message to the Flink LSP WebSocket.
 * @param ws The WebSocket connection.
 * @param params Connection parameters with environment and organization IDs.
 * @param getToken Function to retrieve the data plane token.
 * @throws Error if token retrieval fails or WebSocket send fails.
 */
export async function sendAuthMessage(
  ws: WebSocket,
  params: FlinkLspConnectionParams,
  getToken: TokenProvider,
): Promise<void> {
  const token = await getToken();
  if (!token) {
    throw new Error("Failed to retrieve data plane token for Flink LSP authentication");
  }

  const authMessage = createAuthMessage(token, params.environmentId, params.organizationId);

  return new Promise<void>((resolve, reject) => {
    const messageStr = JSON.stringify(authMessage);
    logger.debug("Sending auth message to Flink LSP", {
      environmentId: params.environmentId,
      organizationId: params.organizationId,
    });

    ws.send(messageStr, (error) => {
      if (error) {
        logger.error("Failed to send auth message to Flink LSP", { error: error.message });
        reject(error);
      } else {
        logger.debug("Auth message sent successfully");
        resolve();
      }
    });
  });
}

/**
 * Replaces the token placeholder in a message string with the actual token.
 * Used for outgoing LSP messages that contain the placeholder.
 * @param message The message string that may contain the placeholder.
 * @param token The actual token to substitute.
 * @returns The message with the placeholder replaced.
 */
export function replaceTokenPlaceholder(message: string, token: string): string {
  if (!message.includes(DATA_PLANE_TOKEN_PLACEHOLDER)) {
    return message;
  }
  return message.replace(DATA_PLANE_TOKEN_PLACEHOLDER, token);
}

/**
 * Checks if a message contains the token placeholder.
 * @param message The message to check.
 * @returns True if the message contains the placeholder.
 */
export function hasTokenPlaceholder(message: string): boolean {
  return message.includes(DATA_PLANE_TOKEN_PLACEHOLDER);
}

/**
 * Creates a message interceptor that replaces token placeholders.
 * Can be used to wrap the WebSocket send method.
 * @param getToken Function to retrieve the current token.
 * @returns A function that transforms messages before sending.
 */
export function createTokenReplacer(getToken: TokenProvider): (message: string) => Promise<string> {
  return async (message: string): Promise<string> => {
    if (!hasTokenPlaceholder(message)) {
      return message;
    }

    const token = await getToken();
    if (!token) {
      logger.warn("Token placeholder found but no token available");
      return message;
    }

    return replaceTokenPlaceholder(message, token);
  };
}
