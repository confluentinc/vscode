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
import {
  ConnectionSpec,
  ConnectionType,
  OAuthCredentials,
  ScramCredentials,
  KerberosCredentials,
} from "../clients/sidecar";

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
      "auth-credentials",
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

  const form = page.locator("form");
  await expect(form).toBeVisible();

  // Check for our various field types to be visible in the form:
  const typeSelect = page.locator("select[name='formconnectiontype']");
  await expect(typeSelect).toBeVisible();
  const typeOptions = await typeSelect.locator("option").all();
  await expect(typeOptions.length).toBe(5);

  const connectionNameInput = page.locator("input[name='name']");
  await expect(connectionNameInput).toBeVisible();

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(bootstrapServersInput).toBeVisible();

  const sslCheckbox = page.locator("input[type='checkbox'][name='kafka_cluster.ssl.enabled']");
  await expect(sslCheckbox).toBeVisible();

  const authKafka = page.locator("select[name='kafka_cluster.auth_type']");
  await expect(authKafka).not.toBe(null);
  const authKafkaOptions = await authKafka.locator("option").all();
  await expect(authKafkaOptions.length).toBe(6);

  const schemaUrlInput = page.locator("input[name='schema_registry.uri']");
  await expect(schemaUrlInput).toBeVisible();

  const schemaSslCheckbox = page.locator(
    "input[type='checkbox'][name='schema_registry.ssl.enabled']",
  );
  await expect(schemaSslCheckbox).toBeVisible();

  const authSchema = page.locator("select[name='schema_registry.auth_type']");
  await expect(authSchema).not.toBe(null);
  const authSchemaOptions = await authSchema.locator("option").all();
  await expect(authSchemaOptions.length).toBe(4); // None, Basic, API, OAuth
});
test("renders form with existing connection spec values (for edit/import)", async ({
  execute,
  page,
}) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(
    async (stub, sample) => {
      stub.withArgs("Submit").resolves(null);
      stub.withArgs("GetConnectionSpec").resolves(sample);
    },
    sendWebviewMessage,
    SPEC_SAMPLE,
  );

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    // redispatching because the page already exists for some time
    // before we actually import the view model application
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });
  // Check that GetConnectionSpec was called
  const specCallHandle = await sendWebviewMessage.evaluateHandle((stub) => stub.getCall(0).args);
  const specCall = await specCallHandle.jsonValue();
  expect(specCall[0]).toBe("GetConnectionSpec");

  const form = page.locator("form");
  await expect(form).toBeVisible();

  // Check that the form fields are populated with the connection spec values
  const nameInput = page.locator("input[name='name']");
  await expect(nameInput).toHaveValue(SPEC_SAMPLE.name);

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(bootstrapServersInput).toHaveValue(SPEC_SAMPLE.kafka_cluster.bootstrap_servers);

  const uriInput = page.locator("input[name='schema_registry.uri']");
  await expect(uriInput).toHaveValue(SPEC_SAMPLE.schema_registry.uri);

  const kafkaSslCheckbox = page.locator("input[type='checkbox'][name='kafka_cluster.ssl.enabled']");
  await expect(await kafkaSslCheckbox?.isChecked()).toBe(true);

  const keystorePathInput = page.locator("input[name='kafka_cluster.ssl.keystore.path']");
  await expect(keystorePathInput).toHaveValue(SPEC_SAMPLE.kafka_cluster.ssl.keystore.path);

  const keystorePasswordInput = page.locator("input[name='kafka_cluster.ssl.keystore.password']");
  await expect(keystorePasswordInput).toHaveValue(SPEC_SAMPLE.kafka_cluster.ssl.keystore.password);

  const keystoreKeyPasswordInput = page.locator(
    "input[name='kafka_cluster.ssl.keystore.key_password']",
  );
  await expect(keystoreKeyPasswordInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.key_password,
  );

  const truststorePathInput = page.locator("input[name='kafka_cluster.ssl.truststore.path']");
  await expect(await truststorePathInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.truststore.path,
  );

  const truststorePasswordInput = page.locator(
    "input[name='kafka_cluster.ssl.truststore.password']",
  );
  await expect(await truststorePasswordInput).toHaveValue(
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
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.fill("input[name='schema_registry.uri']", "http://localhost:8081");
  await page.click("input[type=submit][value='Save']");

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
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "None",
    "kafka_cluster.ssl.enabled": "true",
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "http://localhost:8081",
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
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.fill("input[name='schema_registry.uri']", "http://localhost:8081");
  await page.check("input[type=checkbox][name='kafka_cluster.ssl.enabled']");

  // Submit and check the form data
  await page.click("input[type=submit][value='Save']");
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  const submitCallName = submitCall?.[0];
  expect(submitCallName).toBe("Submit");
  const submitCallData = submitCall?.[1];
  expect(submitCallData).toEqual({
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "None",
    "kafka_cluster.ssl.enabled": "true",
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "http://localhost:8081",
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
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.check("input[type=checkbox][name='kafka_cluster.ssl.enabled']");
  // Click to show the advanced settings, then fill them in
  await page.click("p:has-text('TLS Configuration')");
  await page.selectOption("select[name='kafka_cluster.ssl.truststore.type']", "PKCS12");
  await page.fill("input[name='kafka_cluster.ssl.truststore.path']", "/path/to/truststore");
  await page.fill("input[name='kafka_cluster.ssl.truststore.password']", "truststore-password");
  await page.selectOption("select[name='kafka_cluster.ssl.keystore.type']", "PKCS12");
  await page.fill("input[name='kafka_cluster.ssl.keystore.path']", "/path/to/keystore");
  await page.fill("input[name='kafka_cluster.ssl.keystore.password']", "keystore-password");
  await page.fill("input[name='kafka_cluster.ssl.keystore.key_password']", "key-password");

  // Submit the form
  await page.click("input[type=submit][value='Save']");
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  expect(submitCall?.[0]).toBe("Submit");
  // Verify correct form data
  expect(submitCall?.[1]).toEqual({
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "None",
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "",
    "kafka_cluster.ssl.enabled": "true",
    "kafka_cluster.ssl.keystore.key_password": "key-password",
    "kafka_cluster.ssl.keystore.password": "keystore-password",
    "kafka_cluster.ssl.keystore.path": "/path/to/keystore",
    "kafka_cluster.ssl.keystore.type": "PKCS12",
    "kafka_cluster.ssl.truststore.password": "truststore-password",
    "kafka_cluster.ssl.truststore.path": "/path/to/truststore",
    "kafka_cluster.ssl.truststore.type": "PKCS12",
  });
});
test("adds only edited ssl fields to form data", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(
    async (stub, sample) => {
      stub.withArgs("Update").resolves({ success: true });
      stub.withArgs("GetConnectionSpec").resolves(sample);
    },
    sendWebviewMessage,
    SPEC_SAMPLE,
  );

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  const form = page.locator("form");
  await expect(form).toBeVisible();

  // Check that the form fields are populated with the connection spec values
  const nameInput = page.locator("input[name='name']");
  await expect(await nameInput).toHaveValue(SPEC_SAMPLE.name);

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(await bootstrapServersInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.bootstrap_servers,
  );

  const kafkaSslCheckbox = page.locator("input[type='checkbox'][name='kafka_cluster.ssl.enabled']");
  await expect(await kafkaSslCheckbox?.isChecked()).toBe(true);

  const keystorePathInput = page.locator("input[name='kafka_cluster.ssl.keystore.path']");
  await expect(await keystorePathInput).toHaveValue(SPEC_SAMPLE.kafka_cluster.ssl.keystore.path);

  const keystorePasswordInput = page.locator("input[name='kafka_cluster.ssl.keystore.password']");
  await expect(await keystorePasswordInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.password,
  );

  const keystoreKeyPasswordInput = page.locator(
    "input[name='kafka_cluster.ssl.keystore.key_password']",
  );
  await expect(await keystoreKeyPasswordInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.keystore.key_password,
  );

  const truststorePathInput = page.locator("input[name='kafka_cluster.ssl.truststore.path']");
  await expect(await truststorePathInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.truststore.path,
  );

  const truststorePasswordInput = page.locator(
    "input[name='kafka_cluster.ssl.truststore.password']",
  );
  await expect(await truststorePasswordInput).toHaveValue(
    SPEC_SAMPLE.kafka_cluster.ssl.truststore.password,
  );

  // Edit some of the SSL fields
  await page.fill("input[name='kafka_cluster.ssl.keystore.path']", "/new/path/to/keystore.jks");
  await page.fill("input[name='kafka_cluster.ssl.keystore.password']", "new-keystore-password");
  await page.fill("input[name='kafka_cluster.ssl.truststore.path']", "/new/path/to/truststore.jks");
  await page.fill("input[name='kafka_cluster.ssl.truststore.password']", "");
  await page.selectOption("select[name='kafka_cluster.ssl.truststore.type']", "PKCS12");

  // Submit the form using Update button
  await page.click("input[type='submit'][value='Update']");
  const updateCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Update")?.args,
  );
  const updateCall = await updateCallHandle?.jsonValue();
  expect(updateCall).not.toBeUndefined();
  expect(updateCall?.[0]).toBe("Update");
  // Verify correct form data
  expect(updateCall?.[1]).toEqual({
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "None",
    name: "Sample",
    formconnectiontype: "Apache Kafka",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "http://localhost:8081",
    "kafka_cluster.ssl.enabled": "true",
    "kafka_cluster.ssl.keystore.password": "new-keystore-password",
    "kafka_cluster.ssl.keystore.path": "/new/path/to/keystore.jks",
    "kafka_cluster.ssl.truststore.password": "",
    "kafka_cluster.ssl.truststore.path": "/new/path/to/truststore.jks",
    "kafka_cluster.ssl.truststore.type": "PKCS12",
  });
});
test("adds advanced ssl fields even if section is collapsed", async ({ execute, page }) => {
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
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.check("input[type=checkbox][name='kafka_cluster.ssl.enabled']");
  // Click to show the advanced settings, then fill them in
  await page.click("p:has-text('TLS Configuration')");
  await page.selectOption("select[name='kafka_cluster.ssl.truststore.type']", "PKCS12");
  await page.fill("input[name='kafka_cluster.ssl.truststore.path']", "/path/to/truststore");
  await page.fill("input[name='kafka_cluster.ssl.truststore.password']", "truststore-password");

  // Click to hide the advanced settings, then submit the form
  await page.click("p:has-text('TLS Configuration')");
  await expect(page.locator("input[name='kafka_cluster.ssl.truststore.path']")).not.toBeVisible();
  await page.click("input[type=submit][value='Save']");
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  expect(submitCall?.[0]).toBe("Submit");
  // Verify correct form data
  expect(submitCall?.[1]).toEqual({
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "None",
    "kafka_cluster.ssl.enabled": "true",
    "kafka_cluster.ssl.truststore.password": "truststore-password",
    "kafka_cluster.ssl.truststore.path": "/path/to/truststore",
    "kafka_cluster.ssl.truststore.type": "PKCS12",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "",
  });
});
test("submits values for SASL/SCRAM auth type when filled in", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    stub.withArgs("Submit").resolves(null);
    stub.withArgs("GetAuthTypes").resolves({ kafka: "None", schema: "None" });
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  // Fill in the form with SASL/SCRAM auth type
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.selectOption("select[name='kafka_cluster.auth_type']", "SCRAM");
  // Don't update hash_algorithm, so we can verify it is sent with default value
  // Wait a few milliseconds to ensure the default value is set to form (test is much faster than human)
  await page.waitForTimeout(200);
  // await page.selectOption(
  //   "select[name='kafka_cluster.credentials.hash_algorithm']",
  //   "SCRAM_SHA_256",
  // );
  await page.fill("input[name='kafka_cluster.credentials.scram_username']", "user");
  await page.fill("input[name='kafka_cluster.credentials.scram_password']", "password");

  // Submit the form
  await page.click("input[type=submit][value='Save']");
  await page.waitForTimeout(100); // Wait briefly to ensure the submission completes

  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  expect(submitCall?.[0]).toBe("Submit");
  // Verify correct form data
  expect(submitCall?.[1]).toEqual({
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "SCRAM",
    "kafka_cluster.ssl.enabled": "true",
    "kafka_cluster.credentials.scram_username": "user",
    "kafka_cluster.credentials.scram_password": "password",
    "kafka_cluster.credentials.hash_algorithm": "SCRAM_SHA_256",
    "schema_registry.auth_type": "None",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "",
  });
});
test("populates values for SASL/SCRAM auth type when they're in the spec", async ({
  execute,
  page,
}) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(
    async (stub, sample) => {
      stub.withArgs("Submit").resolves(null);
      stub.withArgs("GetConnectionSpec").resolves(sample);
      stub.withArgs("GetAuthTypes").resolves({ kafka: "SCRAM", schema: "None" });
    },
    sendWebviewMessage,
    SPEC_SAMPLE_SCRAM,
  );

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  const form = page.locator("form");
  await expect(form).toBeVisible();

  // Check that the form fields are populated with the connection spec values
  const nameInput = page.locator("input[name='name']");
  await expect(nameInput).toHaveValue(SPEC_SAMPLE_SCRAM.name!);

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(bootstrapServersInput).toHaveValue(
    SPEC_SAMPLE_SCRAM.kafka_cluster!.bootstrap_servers,
  );

  const kafkaSslCheckbox = page.locator("input[type='checkbox'][name='kafka_cluster.ssl.enabled']");
  await expect(kafkaSslCheckbox).toBeChecked();

  const scramHashAlgoSelect = page.locator(
    "select[name='kafka_cluster.credentials.hash_algorithm']",
  );
  await expect(scramHashAlgoSelect).toHaveValue(SCRAM.hash_algorithm);

  const scramUsernameInput = page.locator("input[name='kafka_cluster.credentials.scram_username']");
  await expect(scramUsernameInput).toHaveValue(
    // @ts-expect-error another example of the type not knowing which creds are present
    SPEC_SAMPLE_SCRAM.kafka_cluster!.credentials!.scram_username,
  );

  const scramPasswordInput = page.locator("input[name='kafka_cluster.credentials.scram_password']");
  await expect(scramPasswordInput).toHaveValue("password");
});
test("submits values for SASL/OAUTHBEARER auth type when filled in", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    stub.withArgs("Submit").resolves(null);
    stub.withArgs("GetAuthTypes").resolves({ kafka: "None", schema: "None" });
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  // Fill in the form with SASL/OAUTHBEARER auth type
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.selectOption("select[name='formconnectiontype']", "Confluent Cloud");
  await page.selectOption("select[name='kafka_cluster.auth_type']", "OAuth");
  await page.fill(
    "input[name='kafka_cluster.credentials.tokens_url']",
    "https://auth-provider.example/oauth2/token",
  );
  await page.fill("input[name='kafka_cluster.credentials.client_id']", "client123");
  await page.fill("input[name='kafka_cluster.credentials.client_secret']", "secret456");
  await page.fill("input[name='kafka_cluster.credentials.scope']", "kafka-cluster");
  await page.fill("input[name='kafka_cluster.credentials.connect_timeout_millis']", "5000");
  await page.fill(
    "input[name='kafka_cluster.credentials.ccloud_logical_cluster_id']",
    "lkc-abc123",
  );
  await page.fill("input[name='kafka_cluster.credentials.ccloud_identity_pool_id']", "pool-xyz789");
  await page.check("input[type=checkbox][name='kafka_cluster.ssl.enabled']");
  await page.check("input[type=checkbox][name='schema_registry.ssl.enabled']");
  await page.fill("input[name='schema_registry.uri']", "http://localhost:8081");
  await page.selectOption("select[name='schema_registry.auth_type']", "OAuth");
  await page.fill(
    "input[name='schema_registry.credentials.tokens_url']",
    "https://auth-provider.example/oauth2/token",
  );
  await page.fill("input[name='schema_registry.credentials.client_id']", "client123");
  await page.fill("input[name='schema_registry.credentials.client_secret']", "secret456");
  await page.fill("input[name='schema_registry.credentials.scope']", "kafka-cluster");
  await page.fill("input[name='schema_registry.credentials.connect_timeout_millis']", "5000");
  await page.fill(
    "input[name='schema_registry.credentials.ccloud_logical_cluster_id']",
    "lkc-abc123",
  );
  await page.fill(
    "input[name='schema_registry.credentials.ccloud_identity_pool_id']",
    "pool-xyz789",
  );

  // Submit the form
  await page.click("input[type=submit][value='Save']");
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  expect(submitCall?.[0]).toBe("Submit");
  // Verify correct form data
  expect(submitCall?.[1]).toEqual({
    name: "Test Connection",
    formconnectiontype: "Confluent Cloud",
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "OAuth",
    "kafka_cluster.credentials.ccloud_identity_pool_id": "pool-xyz789",
    "kafka_cluster.credentials.ccloud_logical_cluster_id": "lkc-abc123",
    "kafka_cluster.credentials.client_id": "client123",
    "kafka_cluster.credentials.client_secret": "secret456",
    "kafka_cluster.credentials.connect_timeout_millis": "5000",
    "kafka_cluster.credentials.scope": "kafka-cluster",
    "kafka_cluster.credentials.tokens_url": "https://auth-provider.example/oauth2/token",
    "kafka_cluster.ssl.enabled": "true",
    "schema_registry.uri": "http://localhost:8081",
    "schema_registry.auth_type": "OAuth",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.credentials.scope": "kafka-cluster",
    "schema_registry.credentials.tokens_url": "https://auth-provider.example/oauth2/token",
    "schema_registry.credentials.ccloud_identity_pool_id": "pool-xyz789",
    "schema_registry.credentials.ccloud_logical_cluster_id": "lkc-abc123",
    "schema_registry.credentials.client_id": "client123",
    "schema_registry.credentials.client_secret": "secret456",
    "schema_registry.credentials.connect_timeout_millis": "5000",
  });
});
test("populates values for SASL/OAUTHBEARER auth type when they exist in the spec (edit/import)", async ({
  execute,
  page,
}) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });
  await execute(
    async (stub, sample) => {
      stub.withArgs("GetConnectionSpec").resolves(sample);
      stub.withArgs("GetAuthTypes").resolves({ kafka: "OAuth", schema: "OAuth" });
    },
    sendWebviewMessage,
    SPEC_SAMPLE_OAUTH,
  );

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  const form = page.locator("form");
  await expect(form).toBeVisible();
  await page.selectOption("select[name='formconnectiontype']", "Confluent Cloud");

  // Check that the form fields are populated with OAuth connection spec values
  const nameInput = page.locator("input[name='name']");
  await expect(nameInput).toHaveValue(SPEC_SAMPLE_OAUTH.name!);

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(bootstrapServersInput).toHaveValue(
    SPEC_SAMPLE_OAUTH.kafka_cluster!.bootstrap_servers,
  );

  // Check Kafka OAuth credentials
  const kafkaAuthTypeSelect = page.locator("select[name='kafka_cluster.auth_type']");
  await expect(kafkaAuthTypeSelect).toHaveValue("OAuth");

  const kafkaTokensUrlInput = page.locator("input[name='kafka_cluster.credentials.tokens_url']");
  await expect(kafkaTokensUrlInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.kafka_cluster.credentials.tokens_url,
  );

  const kafkaClientIdInput = page.locator("input[name='kafka_cluster.credentials.client_id']");
  await expect(kafkaClientIdInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.kafka_cluster.credentials.client_id,
  );

  const kafkaClientSecretInput = page.locator(
    "input[name='kafka_cluster.credentials.client_secret']",
  );
  await expect(kafkaClientSecretInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.kafka_cluster.credentials.client_secret,
  );

  const kafkaClusterIdInput = page.locator(
    "input[name='kafka_cluster.credentials.ccloud_logical_cluster_id']",
  );
  await expect(kafkaClusterIdInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.kafka_cluster.credentials.ccloud_logical_cluster_id,
  );

  // Check Schema Registry OAuth credentials
  const schemaAuthTypeSelect = page.locator("select[name='schema_registry.auth_type']");
  await expect(schemaAuthTypeSelect).toHaveValue("OAuth");

  const schemaTokensUrlInput = page.locator("input[name='schema_registry.credentials.tokens_url']");
  await expect(schemaTokensUrlInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.schema_registry.credentials.tokens_url,
  );

  const schemaClientIdInput = page.locator("input[name='schema_registry.credentials.client_id']");
  await expect(schemaClientIdInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.schema_registry.credentials.client_id,
  );

  const schemaClientSecretInput = page.locator(
    "input[name='schema_registry.credentials.client_secret']",
  );
  await expect(schemaClientSecretInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_OAUTH.schema_registry.credentials.client_secret,
  );
});

test("submits values for Kerberos auth type when filled in", async ({ execute, page }) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(async (stub) => {
    stub.withArgs("Submit").resolves(null);
    stub.withArgs("GetAuthTypes").resolves({ kafka: "None", schema: "None" });
  }, sendWebviewMessage);

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  // Fill in the form with Kerberos auth type
  await page.fill("input[name=name]", "Test Connection");
  await page.fill("input[name='kafka_cluster.bootstrap_servers']", "localhost:9092");
  await page.selectOption("select[name='kafka_cluster.auth_type']", "Kerberos");
  await page.fill("input[name='kafka_cluster.credentials.principal']", "user@EXAMPLE.COM");
  await page.fill("input[name='kafka_cluster.credentials.keytab_path']", "/path/to/keytab");
  // Don't fill in service_name, so we can verify it is sent with default value
  // await page.fill("input[name='kafka_cluster.credentials.service_name']", "kafka");
  // Wait a few milliseconds to ensure the default value is set to form (test is much faster than human)
  await page.waitForTimeout(200);

  // Submit the form
  await page.click("input[type=submit][value='Save']");
  const submitCallHandle = await sendWebviewMessage.evaluateHandle(
    (stub) => stub.getCalls().find((call) => call?.args[0] === "Submit")?.args,
  );
  const submitCall = await submitCallHandle?.jsonValue();
  expect(submitCall).not.toBeUndefined();
  expect(submitCall?.[0]).toBe("Submit");
  // Verify correct form data
  expect(submitCall?.[1]).toEqual({
    name: "Test Connection",
    formconnectiontype: "Apache Kafka",
    "kafka_cluster.bootstrap_servers": "localhost:9092",
    "kafka_cluster.auth_type": "Kerberos",
    "kafka_cluster.credentials.principal": "user@EXAMPLE.COM",
    "kafka_cluster.credentials.keytab_path": "/path/to/keytab",
    "kafka_cluster.credentials.service_name": "kafka",
    "schema_registry.auth_type": "None",
    "kafka_cluster.ssl.enabled": "true",
    "schema_registry.ssl.enabled": "true",
    "schema_registry.uri": "",
  });
});

test("populates values for Kerberos auth type when they exist in the spec (edit/import)", async ({
  execute,
  page,
}) => {
  const sendWebviewMessage = await execute(async () => {
    const { sendWebviewMessage } = await import("./comms/comms");
    return sendWebviewMessage as SinonStub;
  });

  await execute(
    async (stub, sample) => {
      stub.withArgs("GetConnectionSpec").resolves(sample);
      stub.withArgs("GetAuthTypes").resolves({ kafka: "Kerberos", schema: "None" });
    },
    sendWebviewMessage,
    SPEC_SAMPLE_KERBEROS,
  );

  await execute(async () => {
    await import("./main");
    await import("./direct-connect-form");
    window.dispatchEvent(new Event("DOMContentLoaded"));
  });

  const form = page.locator("form");
  await expect(form).toBeVisible();

  // Check that the form fields are populated with Kerberos connection spec values
  const nameInput = page.locator("input[name='name']");
  await expect(nameInput).toHaveValue(SPEC_SAMPLE_KERBEROS.name!);

  const bootstrapServersInput = page.locator("input[name='kafka_cluster.bootstrap_servers']");
  await expect(bootstrapServersInput).toHaveValue(
    SPEC_SAMPLE_KERBEROS.kafka_cluster!.bootstrap_servers,
  );

  // Check Kafka Kerberos credentials
  const kafkaAuthTypeSelect = page.locator("select[name='kafka_cluster.auth_type']");
  await expect(kafkaAuthTypeSelect).toHaveValue("Kerberos");

  const kafkaPrincipalInput = page.locator("input[name='kafka_cluster.credentials.principal']");
  await expect(kafkaPrincipalInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_KERBEROS.kafka_cluster.credentials.principal,
  );

  const kafkaKeytabInput = page.locator("input[name='kafka_cluster.credentials.keytab_path']");
  await expect(kafkaKeytabInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_KERBEROS.kafka_cluster.credentials.keytab_path,
  );

  const kafkaServiceNameInput = page.locator(
    "input[name='kafka_cluster.credentials.service_name']",
  );
  await expect(kafkaServiceNameInput).toHaveValue(
    // @ts-expect-error credentials could be of different types
    SPEC_SAMPLE_KERBEROS.kafka_cluster.credentials.service_name,
  );
});

// Test Fixtures
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
  schema_registry: {
    uri: "http://localhost:8081",
    ssl: {
      enabled: true,
    },
  },
};
const MINIMAL_KAFKA_SAMPLE = {
  id: "123",
  name: "Sample",
  type: "DIRECT" as ConnectionType,
  kafka_cluster: {
    bootstrap_servers: "localhost:9092",
    ssl: {
      enabled: true,
    },
  },
};
const SCRAM: ScramCredentials = {
  hash_algorithm: "SCRAM_SHA_512",
  scram_username: "user",
  scram_password: "password",
};
const SPEC_SAMPLE_SCRAM: ConnectionSpec = {
  ...MINIMAL_KAFKA_SAMPLE,
  kafka_cluster: {
    ...MINIMAL_KAFKA_SAMPLE.kafka_cluster,
    credentials: {
      ...SCRAM,
    },
  },
};
const OAUTH: OAuthCredentials = {
  tokens_url: "https://auth-provider.example/oauth2/token",
  client_id: "client123",
  client_secret: "secret456",
  scope: "kafka-cluster",
  connect_timeout_millis: 5000,
  ccloud_logical_cluster_id: "lkc-abc123",
  ccloud_identity_pool_id: "pool-xyz789",
};
const SPEC_SAMPLE_OAUTH: ConnectionSpec = {
  ...MINIMAL_KAFKA_SAMPLE,
  kafka_cluster: {
    ...MINIMAL_KAFKA_SAMPLE.kafka_cluster,
    credentials: {
      ...OAUTH,
    },
  },
  schema_registry: {
    ...SPEC_SAMPLE.schema_registry,
    ssl: {
      enabled: true,
    },
    credentials: {
      ...OAUTH,
    },
  },
};

const KERBEROS: KerberosCredentials = {
  principal: "user@EXAMPLE.COM",
  keytab_path: "/path/to/keytab",
  service_name: "kafka",
};

const SPEC_SAMPLE_KERBEROS: ConnectionSpec = {
  ...MINIMAL_KAFKA_SAMPLE,
  kafka_cluster: {
    ...MINIMAL_KAFKA_SAMPLE.kafka_cluster,
    credentials: {
      ...KERBEROS,
    },
  },
};
