import * as assert from "assert";
import sinon from "sinon";
import { extensions } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { EXTENSION_ID } from "../constants";
import { type ExtensionConfiguration, ExtensionSetting, Setting, SettingsSection } from "./base";

describe("extensionSettings/base.ts", function () {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  let configurationSections: ExtensionConfiguration[];
  const fakeSectionTitle = "Test Section" as SettingsSection;
  let fakeSection: ExtensionConfiguration;

  before(() => {
    const extension = extensions.getExtension(EXTENSION_ID);
    if (!extension) {
      throw new Error(`Extension with ID "${EXTENSION_ID}" not found`);
    }
    configurationSections = extension.packageJSON.contributes.configuration;
    // add a fake section for testing extra settings
    fakeSection = {
      title: fakeSectionTitle,
      properties: {},
    };
    configurationSections.push(fakeSection);
  });

  after(() => {
    configurationSections.pop(); // remove the fake section after tests
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedConfigs = new StubbedWorkspaceConfiguration(sandbox);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("Setting", function () {
    describe("constructor", () => {
      it("should create an instance with optional sectionTitle as undefined", () => {
        const setting = new Setting("test.internal.setting");

        assert.strictEqual(setting.id, "test.internal.setting");
        assert.strictEqual(setting.sectionTitle, undefined);
      });

      it("should create an instance with the correct 'id' and 'sectionTitle'", () => {
        const setting = new Setting("test.internal.setting", SettingsSection.GENERAL);

        assert.strictEqual(setting.id, "test.internal.setting");
        assert.strictEqual(setting.sectionTitle, SettingsSection.GENERAL);
      });

      it("should create an instance with a custom 'sectionTitle'", () => {
        const setting = new Setting("test.internal.setting", SettingsSection.CCLOUD);

        assert.strictEqual(setting.id, "test.internal.setting");
        assert.strictEqual(setting.sectionTitle, SettingsSection.CCLOUD);
      });
    });

    describe("'.configSection' getter", () => {
      it("should return undefined when sectionTitle is undefined", () => {
        const setting = new Setting("test.internal.setting", undefined);

        const configSection = setting.configSection;

        assert.strictEqual(configSection, undefined);
      });
    });

    describe("'.defaultValue' getter", () => {
      it("should return undefined when sectionTitle is undefined (not in package.json)", () => {
        const setting = new Setting<string>("test.internal.setting", undefined);

        const defaultValue = setting.defaultValue;

        assert.strictEqual(defaultValue, undefined);
      });
    });

    describe("'.value' getter", () => {
      it("should return workspace value or undefined when no sectionTitle is set", () => {
        const settingId = "test.internal.setting";
        const setting = new Setting<string>(settingId, undefined);
        const expectedValue = "confluentinc/medusa";
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, expectedValue);
      });

      it("should return null when workspace value returns null", () => {
        const settingId = "test.internal.setting";
        const setting = new Setting<boolean>(settingId, undefined);
        stubbedConfigs.stubGet(setting, null);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, null);
      });

      it("should handle string settings correctly", () => {
        const settingId = "test.internal.string";
        const defaultValue = "";
        fakeSection.properties = {
          [settingId]: {
            type: "string",
            default: defaultValue,
            description: "A test string setting",
          },
        };

        const setting = new Setting<string>(settingId, fakeSectionTitle);
        const expectedValue = "test-pool-id";
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, expectedValue);
      });

      it("should handle number settings correctly", () => {
        const settingId = "test.internal.number";
        const defaultValue = 0;
        fakeSection.properties = {
          [settingId]: {
            type: "number",
            default: defaultValue,
            description: "A test number setting",
          },
        };

        const setting = new Setting<number>(settingId, fakeSectionTitle);
        const expectedValue = 42;
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, expectedValue);
      });

      it("should handle boolean settings correctly", () => {
        const settingId = "test.internal.boolean";
        const defaultValue = false;
        fakeSection.properties = {
          [settingId]: {
            type: "boolean",
            default: defaultValue,
            description: "A test boolean setting with explicit typing",
          },
        };

        const setting = new Setting<boolean>(settingId, fakeSectionTitle);
        const expectedValue = true;
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, expectedValue);
      });

      it("should handle array settings correctly", () => {
        const settingId = "test.internal.array";
        const defaultValue: string[] = [];
        fakeSection.properties = {
          [settingId]: {
            type: "array",
            items: { type: "string" },
            default: defaultValue,
            description: "A test array setting",
          },
        };

        const setting = new Setting<string[]>(settingId, fakeSectionTitle);
        const expectedValue = ["/path/to/cert1.pem", "/path/to/cert2.pem"];
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.deepStrictEqual(actualValue, expectedValue);
      });

      it("should handle object settings correctly", () => {
        const settingId = "test.internal.object";
        const defaultValue = {};
        fakeSection.properties = {
          [settingId]: {
            type: "object",
            default: defaultValue,
            description: "A test object setting",
          },
        };

        const setting = new Setting<Record<string, string>>(settingId, fakeSectionTitle);
        const expectedValue = { foo: "bar,baz" };
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.deepStrictEqual(actualValue, expectedValue);
      });

      it("should handle nullable settings correctly", () => {
        const settingId = "test.internal.nullable";
        const defaultValue = null;
        fakeSection.properties = {
          [settingId]: {
            type: "string",
            default: defaultValue,
            description: "A test nullable setting",
          },
        };

        const setting = new Setting<string | null>(settingId, fakeSectionTitle);
        const expectedValue = null;
        stubbedConfigs.stubGet(setting, expectedValue);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, expectedValue);
      });
    });
  });

  describe("ExtensionSetting", () => {
    describe("'.configSection' getter", () => {
      for (const section of Object.values(SettingsSection)) {
        it(`should return the correct 'contributes.configuration' section for "${section}"`, () => {
          const setting = new ExtensionSetting("test.internal.setting", section);

          const configSection = setting.configSection;

          assert.strictEqual(configSection.title, section);
          assert.ok(configSection.properties);
        });
      }

      it("should throw error for non-existent 'contributes.configuration' section", () => {
        const setting = new ExtensionSetting(
          "test.internal.setting",
          "Non-existent Section" as any,
        );

        assert.throws(
          () => setting.configSection,
          /Configuration section "Non-existent Section" not found./,
        );
      });
    });

    describe("'.defaultValue' getter", () => {
      it("should return the correct default value for an existing setting", () => {
        const setting = new ExtensionSetting(
          "confluent.showNewVersionNotifications",
          SettingsSection.GENERAL,
        );

        const defaultValue = setting.defaultValue;
        assert.strictEqual(defaultValue, true);
      });

      it("should throw an error if a setting has no default value", () => {
        const settingId = "test.internal.noDefault";
        fakeSection.properties = {
          [settingId]: {
            type: "string",
            description: "A setting with no default",
          },
        };
        configurationSections.push(fakeSection);

        const setting = new ExtensionSetting(settingId, fakeSectionTitle);
        assert.throws(
          () => setting.defaultValue,
          new Error(
            `Default value must be set for setting "${settingId}" in section "${fakeSectionTitle}".`,
          ),
        );
      });
    });

    describe("'.value' getter", () => {
      it("should return the default value if the workspace configuration returns undefined", () => {
        const settingId = "test.internal.undefined";
        const defaultValue = "default-value";
        fakeSection.properties = {
          [settingId]: {
            type: "string",
            default: defaultValue,
            description: "A test string setting with a default value",
          },
        };

        const setting = new ExtensionSetting<string>(settingId, fakeSectionTitle);
        // just to be explicit:
        stubbedConfigs.stubGet(setting, undefined);

        const actualValue = setting.value;

        assert.strictEqual(actualValue, defaultValue);
        sinon.assert.calledOnceWithExactly(stubbedConfigs.get, settingId);
      });
    });
  });
});
