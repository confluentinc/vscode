import { test } from "rollwright";
import { expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import esbuild from "rollup-plugin-esbuild";
import virtual from "@rollup/plugin-virtual";
import alias from "@rollup/plugin-alias";
import { SinonStub } from "sinon";
import sanitize from "sanitize-html";
import { createFilter } from "@rollup/pluginutils";
import { Plugin } from "rollup";

const template = readFileSync(new URL("direct-connect-form.html", import.meta.url), "utf8");
function render(template: string, variables: Record<string, any>) {
  return sanitize(template, {
    allowedAttributes: false,
    allowedTags: sanitize.defaults.allowedTags.concat([
      "head",
      "body",
      "link",
      "form",
      "input",
      "label",
      "select",
      "template",
      "vscode-dropdown",
      "vscode-option",
    ]),
  }).replace(/\$\{([^}]+)\}/g, (_, v) => variables[v]);
}

// strip any stylesheet imports
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
test("renders form html correctly", async ({ page }) => {
  const html = render(template, {
    cspSource: "self",
    nonce: "test-nonce",
    path: (file: string) => `/${file}`,
  });

  await page.setContent(html);

  // Check if the form is rendered correctly
  const form = await page.$("form");
  expect(form).not.toBeNull();

  // Check if the connection type inputs are present
  const typeSelect = await page.$$("select[name='platform']");
  expect(typeSelect).not.toBeNull();

  // Check if the connection name input is present
  const connectionNameInput = await page.$("input[name='name']");
  expect(connectionNameInput).not.toBeNull();

  // Check if the bootstrap servers input is present
  const bootstrapServersInput = await page.$("input[name='bootstrap_servers']");
  expect(bootstrapServersInput).not.toBeNull();

  // Check if the SSL enabled checkbox is present
  const sslCheckbox = await page.$("input[type='checkbox'][name='kafka_ssl']");
  expect(sslCheckbox).not.toBeNull();

  // Check if the kafka authentication type select is present
  const authKafka = await page.$$("select[name='kafka_auth_type']");
  expect(authKafka).not.toBe(null);

  // Check if the schema registry URL input is present
  const schemaUrlInput = await page.$("input[name='uri']");
  expect(schemaUrlInput).not.toBeNull();

  // Check if the schema registry SSL enabled checkbox is present
  const schemaSslCheckbox = await page.$("input[type='checkbox'][name='schema_ssl']");
  expect(schemaSslCheckbox).not.toBeNull();

  // Check if the schema registry authentication type is present
  const authSchema = await page.$$("select[name='schema_auth_type']");
  expect(authSchema).not.toBe(null);
});

test("submits the form with dummy data", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    stub.withArgs("Submit").resolves(null);
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    // redispatching because the page already exists for some time
    // before we actually import the view model application
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  // Fill out the form with dummy data
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name=bootstrap_servers]", "localhost:9092");
  await page.fill("input[name=uri]", "http://localhost:8081");

  // Submit the form
  await page.click("input[type=submit][value='Save']");
  const specCallHandle = await sendWebviewMessage.evaluateHandle((stub) => stub.getCall(0).args);
  const specCall = await specCallHandle.jsonValue();
  expect(specCall[0]).toBe("GetConnectionSpec");
  // Check if the form submission was successful
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  // @ts-expect-error we already checked for undefined
  expect(submitCall[0]).toBe("Submit");
  // @ts-expect-error we already checked for undefined
  expect(submitCall[1]).toEqual({
    bootstrap_servers: "localhost:9092",
    kafka_auth_type: "None",
    name: "Test Connection",
    platform: "Apache Kafka",
    schema_auth_type: "None",
    uri: "http://localhost:8081",
  });
});
