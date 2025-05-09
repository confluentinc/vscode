import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  Command,
  LanguageModelChatMessage,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  MarkdownString,
} from "vscode";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../../authn/constants";
import {
  Connection,
  ConnectionsList,
  ConnectionsResourceApi,
  ConnectionType,
} from "../../clients/sidecar";
import { Logger } from "../../logging";
import { getSidecar } from "../../sidecar";
import { titleCase } from "../../utils";
import { summarizeConnection } from "../summarizers/connections";
import { BaseLanguageModelTool } from "./base";

const logger = new Logger("chat.tools.getConnections");

export interface IGetConnectionsParameters {
  connectionType: ConnectionType;
}

export class GetConnectionsTool extends BaseLanguageModelTool<IGetConnectionsParameters> {
  readonly name = "get_connections";
  readonly progressMessage = "Checking available connections...";

  foundConnectionTypes: ConnectionType[] = [];
  missingConnectionTypes: ConnectionType[] = [];

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetConnectionsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    // reset for each invocation
    this.foundConnectionTypes = [];
    this.missingConnectionTypes = [];

    // use the Connections API to get the list of connections
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();
    const connectionsList: ConnectionsList = await client.gatewayV1ConnectionsGet();

    // keep track of how many connections of each type there are in case we need to add hints to the
    // model to help the user connect to other resources
    const connectionCounts: Map<ConnectionType, number> = new Map([
      [ConnectionType.Ccloud, 0],
      [ConnectionType.Local, 0],
      [ConnectionType.Direct, 0],
    ]);

    // go through each connection type to determine whether to summarize the connection(s) or to
    // provide hints to the user
    const connectionStrings: LanguageModelTextPart[] = [];
    for (const connectionType of connectionCounts.keys()) {
      const connections: Connection[] = connectionsList.data.filter(
        (connection: Connection) => connection.spec.type === connectionType,
      );
      // keep general awareness of how many connections there are per type, even when filtering
      connectionCounts.set(connectionType, connections.length);
      if (params.connectionType && connectionType !== params.connectionType) {
        // if the model is filtering by connection type, skip any other types
        continue;
      }

      if (connections.length) {
        this.foundConnectionTypes.push(connectionType);
        // give each connection type its own markdown header
        const plural = connections.length === 1 ? "" : "s";
        let connectionGroupSummary = new MarkdownString(
          `## ${titleCase(connectionType)} Connection${plural} (${connections.length})`,
        );
        // then summarize each connection
        connections.forEach((connection: Connection) => {
          const connectionSummary: string = summarizeConnection(connection);
          connectionGroupSummary = connectionGroupSummary.appendMarkdown(
            `\n\n${connectionSummary}`,
          );
        });
        connectionStrings.push(new LanguageModelTextPart(connectionGroupSummary.value));
      } else {
        // no connections of this type, so provide a hint to the model about how the user can connect
        this.missingConnectionTypes.push(connectionType);
      }
    }

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
      if (this.foundConnectionTypes.length) {
        let message = new MarkdownString(
          `Below are the details of available connections for you to reference and summarize to the user:\n\n# Connections`,
        );
        for (const part of result.content as LanguageModelTextPart[]) {
          message = message.appendMarkdown(`\n\n${part.value}`);
        }
        messages.push(this.toolMessage(message.value, "result"));
      }

      if (this.missingConnectionTypes.length) {
        let message = new MarkdownString(
          `The following connection types are not available: ${JSON.stringify(this.missingConnectionTypes)}.`,
        );
        if (this.missingConnectionTypes.includes(ConnectionType.Ccloud)) {
          const ccloudCommand: Command = {
            command: "confluent.connections.ccloud.signIn",
            title: CCLOUD_SIGN_IN_BUTTON_LABEL,
          };
          stream.button(ccloudCommand);
        }
        if (this.missingConnectionTypes.includes(ConnectionType.Local)) {
          const localCommand: Command = {
            command: "confluent.docker.startLocalResources",
            title: "Start Local Resources",
          };
          stream.button(localCommand);
        }
        if (this.missingConnectionTypes.includes(ConnectionType.Direct)) {
          const directCommand: Command = {
            command: "confluent.connections.direct",
            title: "Add New Connection",
          };
          stream.button(directCommand);
        }
        messages.push(this.toolMessage(message.value, "result"));
      }
    }

    // TODO(shoup): remove later
    logger.debug(
      `messages:\n\n${messages.map((msg) => `${msg.role.toString()} ${msg.name}: ${msg.content.map((part) => (part as LanguageModelTextPart).value)}`).join("\n")}`,
    );
    return messages;
  }
}
