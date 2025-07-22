import * as assert from "assert";
import sinon from "sinon";
import { extensions } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { EXTENSION_ID } from "../constants";
import { type ExtensionConfiguration, ExtensionSetting, SettingsSection } from "./base";

describe("extensionSettings/base.ts ExtensionSetting", function () {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  let configurationSections: ExtensionConfiguration[];
  const fakeSectionTitle = "Test Section";
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

  describe("constructor", () => {
    it("should create an instance with the correct 'id' and default 'sectionTitle'", () => {
      const setting = new ExtensionSetting("test.setting.id");

      assert.strictEqual(setting.id, "test.setting.id");
      assert.strictEqual(setting.sectionTitle, SettingsSection.GENERAL);
    });

    it("should create an instance with a custom 'sectionTitle'", () => {
      const setting = new ExtensionSetting("test.setting.id", SettingsSection.CCLOUD);

      assert.strictEqual(setting.id, "test.setting.id");
      assert.strictEqual(setting.sectionTitle, SettingsSection.CCLOUD);
    });
  });

  describe("'.configSection' getter", () => {
    for (const section of Object.values(SettingsSection)) {
      it(`should return the correct 'contributes.configuration' section for "${section}"`, () => {
        const setting = new ExtensionSetting("confluent.test.setting", section);

        const configSection = setting.configSection;

        assert.strictEqual(configSection.title, section);
        assert.ok(configSection.properties);
      });
    }

    it("should throw error for non-existent 'contributes.configuration' section", () => {
      const setting = new ExtensionSetting("test.setting.id", "Non-existent Section" as any);

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
      const settingId = "test.setting.noDefault";
      fakeSection.properties = {
        [settingId]: {
          type: "string",
          description: "A setting with no default",
        },
      };
      configurationSections.push(fakeSection);

      const setting = new ExtensionSetting(settingId, fakeSectionTitle as any);
      assert.throws(
        () => setting.defaultValue,
        new Error(
          `Default value must be set for setting "${settingId}" in section "${fakeSectionTitle}".`,
        ),
      );
    });
  });

  describe("'.value' getter", () => {
    it("should return the current workspace configuration value when available", () => {
      const settingId = "test.boolean.setting";
      const defaultValue = true;
      fakeSection.properties = {
        [settingId]: {
          type: "boolean",
          default: defaultValue,
          description: "A test boolean setting",
        },
      };

      const setting = new ExtensionSetting(settingId, fakeSectionTitle as any);
      const expectedValue = false;
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
      sinon.assert.calledOnceWithExactly(stubbedConfigs.get, settingId, defaultValue);
    });

    it("should return the default value if the workspace configuration returns null", () => {
      const settingId = "test.null.setting";
      const defaultValue = "default-value";
      fakeSection.properties = {
        [settingId]: {
          type: "string",
          default: defaultValue,
          description: "A test string setting that does not allow null",
        },
      };

      const setting = new ExtensionSetting<string>(settingId, fakeSectionTitle as any);
      stubbedConfigs.stubGet(setting, null);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, defaultValue);
      sinon.assert.calledOnceWithExactly(stubbedConfigs.get, settingId, defaultValue);
    });

    it("should handle string settings correctly", () => {
      const settingId = "test.string.setting";
      const defaultValue = "";
      fakeSection.properties = {
        [settingId]: {
          type: "string",
          default: defaultValue,
          description: "A test string setting",
        },
      };

      const setting = new ExtensionSetting<string>(settingId, fakeSectionTitle as any);
      const expectedValue = "test-pool-id";
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
    });

    it("should handle number settings correctly", () => {
      const settingId = "test.number.setting";
      const defaultValue = 0;
      fakeSection.properties = {
        [settingId]: {
          type: "number",
          default: defaultValue,
          description: "A test number setting",
        },
      };

      const setting = new ExtensionSetting<number>(settingId, fakeSectionTitle as any);
      const expectedValue = 42;
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
    });

    it("should handle boolean settings correctly", () => {
      const settingId = "test.boolean.explicit";
      const defaultValue = false;
      fakeSection.properties = {
        [settingId]: {
          type: "boolean",
          default: defaultValue,
          description: "A test boolean setting with explicit typing",
        },
      };

      const setting = new ExtensionSetting<boolean>(settingId, fakeSectionTitle as any);
      const expectedValue = true;
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
    });

    it("should handle array settings correctly", () => {
      const settingId = "test.array.setting";
      const defaultValue: string[] = [];
      fakeSection.properties = {
        [settingId]: {
          type: "array",
          items: { type: "string" },
          default: defaultValue,
          description: "A test array setting",
        },
      };

      const setting = new ExtensionSetting<string[]>(settingId, fakeSectionTitle as any);
      const expectedValue = ["/path/to/cert1.pem", "/path/to/cert2.pem"];
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.deepStrictEqual(actualValue, expectedValue);
    });

    it("should handle object settings correctly", () => {
      const settingId = "test.object.setting";
      const defaultValue = {};
      fakeSection.properties = {
        [settingId]: {
          type: "object",
          default: defaultValue,
          description: "A test object setting",
        },
      };

      const setting = new ExtensionSetting<Record<string, string>>(
        settingId,
        fakeSectionTitle as any,
      );
      const expectedValue = { foo: "bar,baz" };
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.deepStrictEqual(actualValue, expectedValue);
    });

    it("should handle nullable settings correctly", () => {
      const settingId = "test.nullable.setting";
      const defaultValue = null;
      fakeSection.properties = {
        [settingId]: {
          type: "string",
          default: defaultValue,
          description: "A test nullable setting",
        },
      };

      const setting = new ExtensionSetting<string | null>(settingId, fakeSectionTitle as any);
      const expectedValue = null;
      stubbedConfigs.stubGet(setting, expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
    });
  });
});
