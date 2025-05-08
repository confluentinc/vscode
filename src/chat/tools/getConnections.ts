import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import {
  Connection,
  ConnectionsList,
  ConnectionsResourceApi,
  ConnectionType,
} from "../../clients/sidecar";
import { Logger } from "../../logging";
import { getSidecar } from "../../sidecar";
import { summarizeConnection } from "../summarizers/connections";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.getConnections");

export interface IGetConnectionsParameters {
  connectionType: ConnectionType;
}

export class GetConnectionsTool extends BaseLanguageModelTool<IGetConnectionsParameters> {
  readonly name = "get_connections";
  readonly progressMessage = "Checking available connections...";

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetConnectionsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    // use the Connections API to get the list of connections
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();
    const connections: ConnectionsList = await client.gatewayV1ConnectionsGet();

    const connectionStrings: LanguageModelTextPart[] = [];
    connections.data.forEach((connection: Connection) => {
      // filter connections by type
      if (params.connectionType && connection.spec.type !== params.connectionType) {
        return;
      }
      const connectionSummary: string = summarizeConnection(connection);
      connectionStrings.push(new LanguageModelTextPart(connectionSummary));
    });

    // TODO(shoup): remove later
    logger.debug(`connectionStrings:\n\n${connectionStrings.map((part) => part.value).join("\n")}`);

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(connectionStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<LanguageModelChatMessage[]> {
    const parameters = toolCall.input as IGetConnectionsParameters;

    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    const messages: LanguageModelChatMessage[] = [];
    if (result.content && Array.isArray(result.content)) {
      let message = `Below are the details of available connections for you to reference and summarize to the user:\n`;
      for (const part of result.content as LanguageModelTextPart[]) {
        message = `${message}\n\n${part.value}`;
      }
      messages.push(this.toolMessage(message, "result"));
    }
    // TODO(shoup): remove later
    logger.debug(
      `messages:\n\n${messages.map((msg) => `${msg.role.toString()} ${msg.name}: ${msg.content.map((part) => (part as LanguageModelTextPart).value)}`).join("\n")}`,
    );
    return messages;
  }
}
