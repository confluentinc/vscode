import { expect } from "@playwright/test";
import alias from "@rollup/plugin-alias";
import virtual from "@rollup/plugin-virtual";
import { createFilter } from "@rollup/pluginutils";
import { readFileSync } from "node:fs";
import { Plugin } from "rollup";
import esbuild from "rollup-plugin-esbuild";
import { test } from "rollwright";
import { SinonStub } from "sinon";
import { ScaffoldV1TemplateSpec } from "../clients/scaffoldingService";

const template = readFileSync(new URL("scaffold-form.html", import.meta.url), "utf8");
function render(template: string, variables: Record<string, any>) {
  return template
    .replace(/\$\{([^}]+)\}/g, (_, v) => variables[v])
    .replace(/<script[^>]+><\/script>/g, "")
    .replace(/<meta\s+http-equiv[^/]+\/>/gm, "");
}

// TEMP just strip any stylesheet imports
function stylesheet(options: any = {}): Plugin {
  const filter = createFilter(options.include, options.exclude);
  return {
    name: "stylesheet",
    async transform(code, id) {
      if (filter(id)) return { code: "" };
    },
  };
}

test.use({
  template: render(template, { nonce: "testing" }),
  plugins: [
    virtual({
      comms: `
        import * as sinon from 'sinon';
        export const sendWebviewMessage = sinon.stub();
      `,
    }),
    alias({ entries: { "./comms/comms": "comms" } }),
    stylesheet({ include: ["**/*.css"], minify: false }),
    esbuild({ jsx: "automatic", target: "es2022", exclude: [/node_modules/] }),
  ],
});

test("dummy form submission", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    const dummy: ScaffoldV1TemplateSpec = {
      version: "0.0.1",
      name: "go-consumer",
      display_name: "Go Consumer Application",
      description:
        "A simple Go project that reads messages from a topic in Confluent Cloud. Ideal for developers new to Kafka who want to learn about stream processing with Kafka.\n",
      language: "Go",
      tags: ["consumer", "getting started", "go"],
      options: {
        cc_bootstrap_server: {
          display_name: "Kafka Bootstrap Server",
          description:
            "One or more comma-separated host and port pairs that are the addresses where Kafka brokers accept client bootstrap requests.",
          pattern:
            "^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-.]{0,61}[a-zA-Z0-9])[:]([0-9]{2,8}))(,([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\\-.]{0,61}[a-zA-Z0-9])[:]([0-9]{2,8}))*$",
          initial_value: "",
        },
        api_key: {
          display_name: "Kafka Cluster API Key",
          description: "The API key for accessing the Kafka cluster in Confluent Cloud.",
          pattern: "^[A-Z0-7=]{16}$",
        },
        api_secret: {
          display_name: "Kafka Cluster API Secret",
          description: "The API secret for accessing the Kafka cluster in Confluent Cloud.",
          format: "password",
          pattern: "^[A-Z0-7=]{64,72}$",
        },
        cc_topic: {
          display_name: "Topic Name",
          description: "The name of the Kafka topic to consume.",
          pattern: "^([a-zA-Z0-9._-]{1,255})$",
        },
        group_id: {
          display_name: "Consumer Group",
          description:
            "A unique string that identifies the consumer group this consumer belongs to. This property is required if the consumer subscribes to a topic or uses the Kafka-based offset management strategy.",
          pattern: "^([a-zA-Z0-9._-]{1,255})$",
        },
        auto_offset_reset: {
          display_name: "Begin Consuming From",
          description:
            "What to do when there is no initial offset in the Kafka topic or if the current offset does not exist any more on the server (e.g. because that data has been deleted).",
          _enum: ["earliest", "latest"],
          initial_value: "earliest",
        },
      },
    };
    const transformedOptions =
      dummy.options !== undefined
        ? Object.entries(dummy.options).reduce(
            (acc, [key, value]) => {
              acc[key] = value.initial_value || "";
              return acc;
            },
            {} as Record<string, string>,
          )
        : {};
    stub.withArgs("GetOptionValues").resolves(transformedOptions);
    stub.withArgs("SetOptionValue").resolves(null);
    stub.withArgs("GetTemplateSpec").resolves(dummy satisfies ScaffoldV1TemplateSpec);
    stub.withArgs("Submit").resolves(null);
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./scaffold-form");
    // redispatching because the page already exists for some time
    // before we actually import the view model application
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  await page.focus("[name=cc_bootstrap_server]");
  await page.keyboard.type("cc_bootstrap_server");
  await page.focus("[name=api_key]");
  await page.keyboard.type("api_key");
  await page.focus("[name=api_secret]");
  await page.keyboard.type("api_secret");
  await page.focus("[name=cc_topic]");
  await page.keyboard.type("cc_topic");
  await page.focus("[name=group_id]");
  await page.keyboard.type("group_id");

  await page.click("input[type=submit]");

  const specCallHandle = await sendWebviewMessage.evaluateHandle((stub) => stub.getCall(0).args);
  const specCall = await specCallHandle.jsonValue();
  expect(specCall[0]).toBe("GetTemplateSpec");

  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  // @ts-expect-error we already checked for undefined
  expect(submitCall[0]).toBe("Submit");
  // @ts-expect-error we already checked for undefined
  expect(submitCall[1]).toEqual({
    data: {
      cc_bootstrap_server: "cc_bootstrap_server",
      api_key: "api_key",
      api_secret: "api_secret",
      cc_topic: "cc_topic",
      group_id: "group_id",
      auto_offset_reset: "earliest",
    },
  });
});
