import * as zlib from "zlib";
import { Message, MessageType } from "./messageTypes";

/**
 * Transport encoding structures for messages sent over websocket. Framing structure
 * includes an encoding type and the data encoded in that format:
 * - EMBEDDED: The Message object is directly embedded in the JSON message in the "embedded" field.
 * - GZIPB64: Gzipped and base64 encoded JSON message, carried in the "string_data" field.
 **/

/** Enumeration describing the websocket transport encoding framings. */
export enum TransportEncoding {
  EMBEDDED = "embedded", // Message is directly embedded in the JSON message in the "embedded_message" field.
  GZIPB64 = "gzipb64", // Gzipped and base64 encoded JSON message, carried in the "string_data" field.
}

/** The interface for the websocket framing structure */
export interface WebsocketTransportMessage {
  encoding: TransportEncoding;
  string_data?: string;
  embedded_message?: Message<MessageType>;
}

/** Encode an API-layer ws.messageTypes.Message for websocket transport. */
export function encodeMessageForWS<T extends MessageType>(
  message: Message<T>,
): WebsocketTransportMessage {
  // Sigh, have to do one json pass to determine if we need to compress.
  // No easy way to determine the size of the stringified JSON without stringifying it.
  const messageJson = JSON.stringify(message);

  if (messageJson.length > 64 * 1024) {
    // If the message is too large ( > 64Kb), compress it
    return {
      encoding: TransportEncoding.GZIPB64,
      string_data: zlib.gzipSync(Buffer.from(messageJson)).toString("base64"),
    };
  } else {
    // Otherwise, send the message as-is, embedded in the transport message. It won't
    // have any additional framing / escaping in its string representation.
    return {
      encoding: TransportEncoding.EMBEDDED,
      embedded_message: message,
    };
  }
}

export function decodeMessageFromWS<T extends MessageType>(
  transportMessage: WebsocketTransportMessage,
): Message<T> {
  let decodedMessage: Message<T>;
  let rawJson: string;
  switch (transportMessage.encoding) {
    case TransportEncoding.EMBEDDED:
      decodedMessage = transportMessage.embedded_message as Message<T>;
      break;
    case TransportEncoding.GZIPB64:
      rawJson = zlib.gunzipSync(Buffer.from(transportMessage.string_data!, "base64")).toString();
      decodedMessage = JSON.parse(rawJson) as Message<T>;
      break;
    default:
      throw new Error(`Unknown encoding: ${transportMessage.encoding}`);
  }

  if (!decodedMessage.headers || !decodedMessage.headers.message_type) {
    throw new Error("Invalid message: missing headers");
  }

  return decodedMessage;
}
