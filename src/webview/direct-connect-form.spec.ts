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
      "option",
      "template",
      "vscode-dropdown",
      "vscode-option",
      "ssl-config",
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

  const form = await page.$("form");
  expect(form).not.toBeNull();

  // Check for our various field types to be in the form:
  const typeSelect = await page.$$("select[name='platform']");
  expect(typeSelect).not.toBeNull();
  const typeOptions = await typeSelect[0].$$("option");
  expect(typeOptions.length).toBe(4);

  const connectionNameInput = await page.$("input[name='name']");
  expect(connectionNameInput).not.toBeNull();

  const bootstrapServersInput = await page.$("input[name='bootstrap_servers']");
  expect(bootstrapServersInput).not.toBeNull();

  const sslCheckbox = await page.$("input[type='checkbox'][name='kafka_ssl']");
  expect(sslCheckbox).not.toBeNull();

  const authKafka = await page.$$("select[name='kafka_auth_type']");
  expect(authKafka).not.toBe(null);
  const authKafkaOptions = await authKafka[0].$$("option");
  expect(authKafkaOptions.length).toBe(3);

  const schemaUrlInput = await page.$("input[name='uri']");
  expect(schemaUrlInput).not.toBeNull();

  const schemaSslCheckbox = await page.$("input[type='checkbox'][name='schema_ssl']");
  expect(schemaSslCheckbox).not.toBeNull();

  const authSchema = await page.$$("select[name='schema_auth_type']");
  expect(authSchema).not.toBe(null);
  const authSchemaOptions = await authSchema[0].$$("option");
  expect(authSchemaOptions.length).toBe(3);
});
test("renders form with connection spec values for edit", async ({ execute, page }) => {
  const SPEC_SAMPLE = {
    id: "123",
    name: "Sample",
    type: "DIRECT",
    kafka_cluster: {
      bootstrap_servers: "localhost:9092",
      ssl: {
        enabled: true,
        keystore: {
          path: "/path/to/keystore.jks",
          type: "JKS",
          password: "keystore-password",
          key_password: "key-password",
        },
        truststore: {
          path: "/path/to/truststore.jks",
          type: "JKS",
          password: "truststore-password",
        },
      },
    },
  };
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    const SPEC_SAMPLE = {
      id: "123",
      name: "Sample",
      type: "DIRECT",
      kafka_cluster: {
        bootstrap_servers: "localhost:9092",
        ssl: {
          enabled: true,
          keystore: {
            path: "/path/to/keystore.jks",
            type: "JKS",
            password: "keystore-password",
            key_password: "key-password",
          },
          truststore: {
            path: "/path/to/truststore.jks",
            type: "JKS",
            password: "truststore-password",
          },
        },
      },
    };
    stub.withArgs("Submit").resolves(null);
    stub.withArgs("GetConnectionSpec").resolves(SPEC_SAMPLE);
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    // redispatching because the page already exists for some time
    // before we actually import the view model application
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  const form = await page.$("form");
  expect(form).not.toBeNull();

  // Check that the form fields are populated with the connection spec values
  const nameInput = await page.$("input[name='name']");
  expect(await nameInput?.getAttribute("value")).toBe(SPEC_SAMPLE.name);

  const bootstrapServersInput = await page.$("input[name='bootstrap_servers']");
  expect(await bootstrapServersInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.bootstrap_servers,
  );

  // const uriInput = await page.$("input[name='uri']");
  // expect(await uriInput?.getAttribute("value")).toBe(SPEC_SAMPLE.uri);

  const kafkaSslCheckbox = await page.$("input[type='checkbox'][name='kafka_ssl']");
  expect(await kafkaSslCheckbox?.isChecked()).toBe(true);

  const keystorePathInput = await page.$("input[name='keystore_path']");
  expect(await keystorePathInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.path,
  );

  const keystorePasswordInput = await page.$("input[name='keystore_password']");
  expect(await keystorePasswordInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.password,
  );

  const keystoreKeyPasswordInput = await page.$("input[name='keystore_key_password']");
  expect(await keystoreKeyPasswordInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.key_password,
  );

  const truststorePathInput = await page.$("input[name='truststore_path']");
  expect(await truststorePathInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.ssl.truststore.path,
  );

  const truststorePasswordInput = await page.$("input[name='truststore_password']");
  expect(await truststorePasswordInput?.getAttribute("value")).toBe(
    SPEC_SAMPLE.kafka_cluster.ssl.truststore.password,
  );
});

test("submits the form with defaults & dummy data", async ({ execute, page }) => {
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

  // Fill out the form with dummy data & submit
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name=bootstrap_servers]", "localhost:9092");
  await page.fill("input[name=uri]", "http://localhost:8081");
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
  const submitCallName = submitCall?.[0];
  expect(submitCallName).toBe("Submit");
  const submitCallData = submitCall?.[1];
  expect(submitCallData).toEqual({
    bootstrap_servers: "localhost:9092",
    kafka_auth_type: "None",
    name: "Test Connection",
    platform: "Apache Kafka",
    schema_auth_type: "None",
    uri: "http://localhost:8081",
  });
});
test("submits the form with empty trust/key stores as defaults when ssl enabled", async ({
  execute,
  page,
}) => {
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
  await page.check("input[type=checkbox][name=kafka_ssl]");

  // Check that ssl config fields show
  const verify = await page.$("input[type=checkbox][name=verify_hostname]");
  expect(verify).not.toBeNull();
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
    kafka_ssl: "on",
  });
});
test("submits the form with namespaced ssl advanced config fields when filled", async ({
  execute,
  page,
}) => {
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

  // Fill in our kafka + kafka ssl config settings
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name=bootstrap_servers]", "localhost:9092");
  await page.check("input[type=checkbox][name=kafka_ssl]");
  await page.check("input[type=checkbox][name=verify_hostname]");

  await page.selectOption("select[name=truststore_type]", "PEM");
  await page.fill("input[name=truststore_path]", "/path/to/truststore");
  await page.fill("input[name=truststore_password]", "truststore-password");

  await page.selectOption("select[name=keystore_type]", "PEM");
  await page.fill("input[name=keystore_path]", "/path/to/keystore");
  await page.fill("input[name=keystore_password]", "keystore-password");
  await page.fill("input[name=keystore_key_password]", "key-password");

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
    uri: "",
    kafka_ssl: "on",
    kafka_ssl_keystore_key_password: "key-password",
    kafka_ssl_keystore_password: "keystore-password",
    kafka_ssl_keystore_path: "/path/to/keystore",
    kafka_ssl_keystore_type: "PEM",
    kafka_ssl_truststore_password: "truststore-password",
    kafka_ssl_truststore_path: "/path/to/truststore",
    kafka_ssl_truststore_type: "PEM",
  });
});
