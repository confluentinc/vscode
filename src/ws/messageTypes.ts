/** Module describing workspace<-->sidecar websocket messages. */

import { randomUUID } from "crypto";

/**
 * All websocket message types, message.header_type values.
 * Some come in request/response pairs, others are individual events, either
 * directed at a single workspace or to sidecar or broadcast to all workspaces.
 */
export enum MessageType {
  /** When workspace makes websocket connection, it must then pass its process id over in a HELLO message. */
  WORKSPACE_HELLO = "WORKSPACE_HELLO",

  /**  When a new workspace connects and is granted access, or when a workspace disconnects,
    sidecar will send this message to all workspaces. */
  WORKSPACE_COUNT_CHANGED = "WORKSPACE_COUNT_CHANGED",

  /** Sidecar didn't like something we said or did and is telling us about it right before it hangs up. */
  PROTOCOL_ERROR = "PROTOCOL_ERROR",
}

/** Header structure for websocket messages. */
export interface MessageHeaders {
  /** Type of message. Dictates what the message body structure should be. */
  message_type: MessageType;

  /** Originator of the message. Either the sending workspace's process id, or "sidecar". */
  originator: string;

  /** Stringified UUID4 uniquely identifying the message. */
  message_id: string;
}

export interface ReplyMessageHeaders extends MessageHeaders {
  /** Used to correlate responses to requests. Holds message_id value of the message being replied to. */
  response_to_id: string;
}

/** Construct and return either a MessageHeaders or ReplyMessageHeaders given the message type, audience, and possible response_to_id value. */
export function newMessageHeaders<T extends MessageType>(
  message_type: T,
  response_to_id?: string,
): MessageHeaderMap[T] {
  return {
    message_type,
    originator: process.pid.toString(),
    message_id: randomUUID().toString(),
    ...(response_to_id ? { response_to_id } : {}),
  } as MessageHeaderMap[T];
}

/**
 * Websocket message structure. Generic over the body payload whose structure
 * is determined by the message type.
 **/
export interface Message<T extends MessageType> {
  headers: MessageHeaderMap[T];
  body: MessageBodyMap[T];
}

/** A message whose headers carry field "response_to_id", indicating is a response message. */
export interface ResponseMessage<T extends MessageType> extends Message<T> {
  headers: ReplyMessageHeaders;
}

/**
 * Workspace -> sidecar message body, sent when a workspace connects to sidecar,
 * corresponding to message_type {@link MessageType.WORKSPACE_HELLO}
 */
export interface WorkspaceHelloBody {
  workspace_id: number;
}

/**
 * Sidecar -> workspaces message body, sent whenever the total number of authorized websocket connections to sidecar changes.
 * Corresponds to message_type {@link MessageType.WORKSPACE_COUNT_CHANGED}
 */
export interface WorkspacesChangedBody {
  current_workspace_count: number;
}

/** Sidecar -> workspace message send if/when sidecar has detected an issue with what extension has said. Will be
 * sent to the workspace that sent the message that caused the issue, then the websocket disconnected.
 */
export interface ProtocolErrorBody {
  error: string;
}

/** Type mapping of message type -> corresponding message body type */
export type MessageBodyMap = {
  [MessageType.WORKSPACE_HELLO]: WorkspaceHelloBody;
  [MessageType.WORKSPACE_COUNT_CHANGED]: WorkspacesChangedBody;
  [MessageType.PROTOCOL_ERROR]: ProtocolErrorBody;
};

/**
 * Type mapping of message type -> corresponding headers type.
 * Dictates which messages whose headers should have `response_to_id` field.`
 */
type MessageHeaderMap = {
  [MessageType.WORKSPACE_HELLO]: MessageHeaders;
  [MessageType.WORKSPACE_COUNT_CHANGED]: MessageHeaders;
  [MessageType.PROTOCOL_ERROR]: ReplyMessageHeaders;
};

/**
 *  Validate the fields of a message body having just come from JSON with its corresponding message type.
 *  Alas, TypeScript doesn't have a way to enforce that the body is of the correct type for the message type,
 *  so we have to do it manually.
 */
export function validateMessageBody(messageType: MessageType, body: unknown): void {
  if (messageType === MessageType.WORKSPACE_COUNT_CHANGED) {
    if (
      typeof body !== "object" ||
      !body ||
      typeof (body as WorkspacesChangedBody).current_workspace_count !== "number"
    ) {
      throw new Error(`Invalid body for message type ${MessageType.WORKSPACE_COUNT_CHANGED}`);
    }
  } else if (messageType === MessageType.PROTOCOL_ERROR) {
    if (
      typeof body !== "object" ||
      !body ||
      typeof (body as ProtocolErrorBody).error !== "string"
    ) {
      throw new Error(`Invalid body for message type ${MessageType.PROTOCOL_ERROR}`);
    }
  } else {
    throw new Error(`validateMessageBody(): Unknown message type: ${messageType}`);
  }
}