/** Module describing workspace<-->sidecar websocket messages. */

import { randomUUID } from "crypto";

/**
 * All websocket message types, message.header_type values.
 * Some come in request/response pairs, others are individual events, either
 * directed at a single workspace or to sidecar or broadcast to all workspaces.
 */
export enum MessageType {
  // When a new workspace connects and is granted access, or when a workspace disconnects,
  // sidecar will send this message to all workspaces.
  WORKSPACE_COUNT_CHANGED = "WORKSPACE_COUNT_CHANGED",
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
 * Sidecar -> workspaces message body, sent whenever the total number of authorized websocket connections to sidecar changes.
 * Corresponds to message_type {@link MessageType.WORKSPACE_COUNT_CHANGED}
 */
export interface WorkspacesChangedBody {
  current_workspace_count: number;
}

/** Type mapping of message type -> corresponding message body type */
type MessageBodyMap = {
  [MessageType.WORKSPACE_COUNT_CHANGED]: WorkspacesChangedBody;
};

/**
 * Type mapping of message type -> corresponding headers type.
 * Dictates which messages whose headers should have `response_to_id` field.`
 */
type MessageHeaderMap = {
  [MessageType.WORKSPACE_COUNT_CHANGED]: MessageHeaders;
};
