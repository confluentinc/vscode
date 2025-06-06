import * as assert from "assert";
import * as sinon from "sinon";
import * as authnUtils from "../../authn/utils";
import { determineFlinkStatementName, localTimezoneOffset } from "./flinkStatements";

describe("commands/utils/flinkStatements.ts localTimezoneOffset()", function () {
  let originalTimezone: string | undefined;

  beforeEach(() => {
    originalTimezone = process.env.TZ;
  });
  afterEach(() => {
    if (originalTimezone) {
      process.env.TZ = originalTimezone;
    } else {
      delete process.env.TZ;
    }
  });

  it("Should extract offset relative to GMT", async function () {
    // Pin down timezone. May still be DST or not though based on the datetime.
    // (Can only do this once; internals of Date will cache the timezone offset?)
    process.env.TZ = "America/Los_Angeles";

    // This should be GMT-0700 for PDT or GMT-0800 for PST
    const offset = localTimezoneOffset();
    assert.strictEqual(offset.startsWith("GMT"), true, "Offset should end with GMT");
    // Fourth character should be + or -
    assert.strictEqual(offset[3] === "+" || offset[3] === "-", true, "Offset should be + or -");

    // Remainder will be either 0700 or 0800
    assert.strictEqual(
      offset.slice(4, 6) === "07" || offset.slice(4, 6) === "08",
      true,
      "Offset should be 0700 or 0800",
    );
    assert.strictEqual(offset.slice(6, 8) === "00", true, "Offset should be 00");
  });
});

describe("determineFlinkStatementName()", function () {
  let sandbox: sinon.SinonSandbox;
  let getCCloudAuthSessionStub: sinon.SinonStub;

  const now = new Date("2024-10-21 12:00:00.0000Z");
  const expectedDatePart = "2024-10-21t12-00-00";

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    getCCloudAuthSessionStub = sandbox.stub(authnUtils, "getCCloudAuthSession");
    sandbox.useFakeTimers(now);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Should return a unique name for a Flink statement", async function () {
    // will be lowercased, reduced to 'joe'
    getCCloudAuthSessionStub.resolves({
      account: { label: "Joe+spam@confluent.io", id: "u-abc123" },
    });

    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `joe-vscode-${expectedDatePart}`);
  });

  it("Works with degenerate ccloud username", async function () {
    getCCloudAuthSessionStub.resolves({ account: { label: "simple", id: "u-abc123" } });

    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `simple-vscode-${expectedDatePart}`);
  });

  it("Handles crazy case if ccloud isn't authenticated", async function () {
    getCCloudAuthSessionStub.resolves(undefined);
    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `unknownuser-vscode-${expectedDatePart}`);
  });

  it("Should remove all non-alphanumeric characters (except for hyphens) from the username", async function () {
    getCCloudAuthSessionStub.resolves({
      account: {
        label: "VS_Code.Dev-Team@confluent.io",
        id: "u-abc123",
      },
    });

    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `vscodedev-team-vscode-${expectedDatePart}`);
  });

  it("Should remove leading numeric characters from the username", async function () {
    getCCloudAuthSessionStub.resolves({
      account: {
        label: "42_VS_Code.Devs-42@confluent.io",
        id: "u-abc123",
      },
    });

    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `vscodedevs-42-vscode-${expectedDatePart}`);
  });

  it("Should remove leading hyphens from the username", async function () {
    getCCloudAuthSessionStub.resolves({
      account: {
        // I don't think this is a valid email address, but we should still trim
        // the leading hyphen from the statement name.
        label: "-vscode-devs@confluent.io",
        id: "u-abc123",
      },
    });

    const statementName = await determineFlinkStatementName();
    assert.strictEqual(statementName, `vscode-devs-vscode-${expectedDatePart}`);
  });
});
