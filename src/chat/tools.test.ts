import * as vscode from "vscode";
import { GenerateProjectTool, IGenerateProjectParameters } from "./tools";
import { expect } from "@playwright/test";

describe.only("GenerateProjectTool", () => {
  //  placeholder right now, needs update once we actually call the scaffolding service
  let tool: GenerateProjectTool;

  beforeEach(() => {
    tool = new GenerateProjectTool();
  });

  describe("invoke", () => {
    it("should generate a project structure successfully", async () => {
      const input: IGenerateProjectParameters = {
        cc_bootstrap_server: "broker.confluent.cloud:9092",
        cc_topic: "test-topic",
      };

      const result = await tool.invoke(
        {
          input,
          toolInvocationToken: undefined,
        },
        {} as vscode.CancellationToken,
      );

      expect(result).toBeDefined();
      expect(result.content).toHaveLength(1);
    });

    it("should throw an error if cc_bootstrap_server is missing", async () => {
      const input: IGenerateProjectParameters = {
        cc_bootstrap_server: "",
        cc_topic: "test-topic",
      };

      await expect(
        tool.invoke(
          {
            input,
            toolInvocationToken: undefined,
          },
          {} as vscode.CancellationToken,
        ),
      ).rejects.toThrow("All parameters (cc_bootstrap_server, cc_topic) are required.");
    });

    it("should throw an error if cc_topic is missing", async () => {
      const input: IGenerateProjectParameters = {
        cc_bootstrap_server: "broker.confluent.cloud:9092",
        cc_topic: "",
      };

      await expect(
        tool.invoke(
          {
            input,
            toolInvocationToken: undefined,
          },
          {} as vscode.CancellationToken,
        ),
      ).rejects.toThrow("All parameters (cc_bootstrap_server, cc_topic) are required.");
    });
  });

  describe("prepareInvocation", () => {
    it("should return a confirmation message", async () => {
      const input: IGenerateProjectParameters = {
        cc_bootstrap_server: "broker.confluent.cloud:9092",
        cc_topic: "test-topic",
      };

      const result = await tool.prepareInvocation(
        {
          input,
        },
        {} as vscode.CancellationToken,
      );

      expect(result).toBeDefined();
    });
  });
});
