import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolInvocationOptions,
  LanguageModelToolResult,
  MarkdownString,
} from "vscode";
import { ContainerInspectResponse, ContainerSummary, SystemApi } from "../../clients/docker";
import { defaultRequestInit } from "../../docker/configs";
import { LocalResourceKind } from "../../docker/constants";
import { getContainer } from "../../docker/containers";
import { Logger } from "../../logging";
import {
  getLocalKafkaContainers,
  getLocalSchemaRegistryContainers,
} from "../../sidecar/connections/local";
import { summarizeLocalDockerContainer } from "../summarizers/dockerContainers";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getDockerContainers");

export interface IGetDockerContainersParameters {
  resourceKind: LocalResourceKind;
}

export class GetDockerContainersTool extends BaseLanguageModelTool<IGetDockerContainersParameters> {
  readonly name = "get_dockerContainers";

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetDockerContainersParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    // verify we're only trying to look up Kafka/SR containers
    const validKinds: LocalResourceKind[] = Object.values(LocalResourceKind);
    if (!validKinds.includes(params.resourceKind)) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `The resource kind "${params.resourceKind}" is not valid. Select one of ${JSON.stringify(validKinds)} and try again.`,
        ),
      ]);
    }

    // first check if Docker is available, and if not, let the model know what the error is
    const client = new SystemApi();
    const init: RequestInit = await defaultRequestInit();
    try {
      await client.systemPing(init);
    } catch (error) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(`Unable to connect to the Docker engine: "${error}"`),
      ]);
    }

    // get the array of ContainerSummary objects first -- not filtering by container status so the
    // model can see all Kafka/SR containers (running, stopped, etc.)
    let summaries: ContainerSummary[] = [];
    switch (params.resourceKind) {
      case LocalResourceKind.Kafka:
        summaries = await getLocalKafkaContainers({
          statuses: [],
        });
        break;
      case LocalResourceKind.SchemaRegistry:
        summaries = await getLocalSchemaRegistryContainers({
          statuses: [],
        });
        break;
    }
    if (!summaries.length) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No Docker containers found for resource kind "${params.resourceKind}".`,
        ),
      ]);
    }

    // if we have at least one ContainerSummary, inspect to get config.env details
    const inspectPromises: Promise<ContainerInspectResponse>[] = [];
    summaries.forEach((summary) => {
      if (summary.Id) {
        inspectPromises.push(getContainer(summary.Id));
      }
    });
    const containers: ContainerInspectResponse[] = await Promise.all(inspectPromises);
    if (!containers.length) {
      // shouldn't happen since we just got summaries
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No Docker containers found for resource kind "${params.resourceKind}".`,
        ),
      ]);
    }

    // ...finally, summarize the containers
    const containerStrings: LanguageModelTextPart[] = [];
    let summary = new MarkdownString(`# Docker Containers (${containers.length})`);
    containers.forEach((container: ContainerInspectResponse) => {
      const containerSummary: string = summarizeLocalDockerContainer(container);
      summary = summary.appendMarkdown(`\n${containerSummary}`);
    });
    containerStrings.push(new LanguageModelTextPart(summary.value));

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(containerStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IGetDockerContainersParameters;

    stream.progress(
      `Retrieving available Docker containers with parameters: ${JSON.stringify(parameters)}...`,
    );

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );
    stream.progress(`Found ${result.content.length} Docker containers.`);
    if (!result.content.length) {
      // cancellation / no results
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    const resultsHeader = new LanguageModelTextPart(
      `The following Docker containers are available for resource kind "${parameters.resourceKind}":`,
    );
    resultParts.push(resultsHeader);
    resultParts.push(...(result.content as LanguageModelTextPart[]));
    // no footer needed

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
