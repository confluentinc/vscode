import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
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

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetConnectionsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;
    logger.debug("params:", params);

    // use the Connections API to get the list of connections
    const sidecar = await getSidecar();
    const client: ConnectionsResourceApi = sidecar.getConnectionsResourceApi();
    const connectionsList: ConnectionsList = await client.gatewayV1ConnectionsGet();

    // ...then handle all of the text-formatting to tell the model only the information that's needed
    const connectionStrings: LanguageModelTextPart[] = [];
    if (connectionsList.data.length) {
      // group by type to keep summaries concise
      const connectionsMap: Map<ConnectionType, Connection[]> = new Map();
      connectionsList.data.forEach((connection: Connection) => {
        const type: ConnectionType = connection.spec.type!;
        if (!connectionsMap.has(type)) {
          connectionsMap.set(type, []);
        }
        connectionsMap.get(type)?.push(connection);
      });

      // give each connection type its own header
      for (const [type, connections] of connectionsMap.entries()) {
        if (params.connectionType && type !== params.connectionType) {
          // if the model is filtering by connection type, skip any other types
          continue;
        }
        const plural = connections.length === 1 ? "" : "s";
        let connectionGroupSummary = new MarkdownString(
          `## ${titleCase(type)} Connection${plural} (${connections.length})`,
        );
        // then summarize each connection
        connections.forEach((connection: Connection) => {
          const connectionSummary: string = summarizeConnection(connection);
          connectionGroupSummary = connectionGroupSummary.appendMarkdown(
            `\n\n${connectionSummary}`,
          );
        });
        connectionStrings.push(new LanguageModelTextPart(connectionGroupSummary.value));
      }
    } else {
      // show placeholders for signing in to CCloud, starting local resources, or connecting directly
      const ccloudButton = `[${CCLOUD_SIGN_IN_BUTTON_LABEL}](command:confluent.connections.ccloud.signIn)`;
      const localResourcesButton = `[Start Local Resources](command:confluent.docker.startLocalResources)`;
      const directConnectionButton = `[Connect Directly](command:confluent.connections.direct)`;

      const noConnectionsMarkdown = new MarkdownString(`No connections found.`)
        .appendMarkdown(`\n\n- Connect to Confluent Cloud by signing in:\n\n${ccloudButton}`)
        .appendMarkdown(
          `\n\n- Start local resources (Kafka, Schema Registry, etc.) by running:\n\n${localResourcesButton}`,
        )
        .appendMarkdown(
          `\n\n- Connect directly to a Kafka cluster or Schema registry with:\n\n${directConnectionButton}`,
        );
      connectionStrings.push(new LanguageModelTextPart(noConnectionsMarkdown.value));
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
      let message = new MarkdownString(
        `Below are the details of available connections for you to reference and summarize to the user:\n\n# Connections`,
      );
      for (const part of result.content as LanguageModelTextPart[]) {
        message = message.appendMarkdown(`\n\n${part.value}`);
      }
      messages.push(this.toolMessage(message.value, "result"));
    }
    // TODO(shoup): remove later
    logger.debug(
      `messages:\n\n${messages.map((msg) => `${msg.role.toString()} ${msg.name}: ${msg.content.map((part) => (part as LanguageModelTextPart).value)}`).join("\n")}`,
    );
    return messages;
  }
}
