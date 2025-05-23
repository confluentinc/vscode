import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
} from "vscode";
import { ResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { Environment } from "../../models/environment";
import { ConnectionId } from "../../models/resource";
import { summarizeEnvironment } from "../summarizers/environments";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getEnvironments");

export const NO_RESULTS: string = "No environments found.";

export interface IGetEnvironmentsParameters {
  connectionId: ConnectionId;
}

export class GetEnvironmentsTool extends BaseLanguageModelTool<IGetEnvironmentsParameters> {
  readonly name = "get_environments";

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetEnvironmentsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    if (!params.connectionId) {
      logger.debug("No connection ID provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          "No connection ID provided. Provide a valid connection ID from the 'get_connections' tool and try again.",
        ),
      ]);
    }

    const loader = ResourceLoader.getInstance(params.connectionId);
    const environments: Environment[] = await loader.getEnvironments();
    if (!environments.length) {
      logger.debug("No environments found");
      // TODO: add hinting? the user shouldn't get here if they have at least one connection
      return new LanguageModelToolResult([new LanguageModelTextPart(NO_RESULTS)]);
    }

    const environmentStrings: LanguageModelTextPart[] = [];
    for (const env of environments) {
      const envString: string = summarizeEnvironment(env);
      environmentStrings.push(new LanguageModelTextPart(`\n${envString}`));
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(environmentStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IGetEnvironmentsParameters;

    stream.progress(
      `Retrieving available environments with parameters: ${JSON.stringify(parameters)}...`,
    );
    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    stream.progress(`Found ${result.content.length} environments.`);
    if (!result.content.length) {
      // cancellation
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    const contents = result.content as LanguageModelTextPart[];
    if (contents.length === 1 && contents[0].value === NO_RESULTS) {
      const resultsHeader = new LanguageModelTextPart("No environments found.");
      resultParts.push(resultsHeader);
    } else {
      const resultsHeader = new LanguageModelTextPart("Here are your available environments:");
      resultParts.push(resultsHeader);
      resultParts.push(...contents);
      // Add footer hint for follow-up tool calls
      const footerHint = new LanguageModelTextPart(
        "\nTo interact with these environments, use their IDs in follow-up tool calls, such as or 'list_topics'.",
      );
      resultParts.push(footerHint);
    }

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
