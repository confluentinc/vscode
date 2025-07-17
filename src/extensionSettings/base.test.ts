import * as assert from "assert";
import sinon from "sinon";
import { extensions } from "vscode";
import { StubbedWorkspaceConfiguration } from "../../tests/stubs/workspaceConfiguration";
import { EXTENSION_ID } from "../constants";
import { type ExtensionConfigurations, ExtensionSetting, SettingsSection } from "./base";

describe("extensionSettings/base.ts ExtensionSetting", function () {
  let sandbox: sinon.SinonSandbox;
  let stubbedConfigs: StubbedWorkspaceConfiguration;

  let configurationSections: ExtensionConfigurations[];
  const fakeSectionTitle = "Test Section";
  let fakeSection: ExtensionConfigurations;

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
      assert.strictEqual(setting.sectionTitle, SettingsSection.MAIN);
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
        SettingsSection.MAIN,
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
      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(expectedValue);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, expectedValue);
      sinon.assert.calledOnceWithExactly(stubbedConfigs.get, settingId, defaultValue);
    });

    it("should return default value when workspace configuration is undefined", () => {
      const settingId = "test.boolean.undefined";
      const defaultValue = true;
      fakeSection.properties = {
        [settingId]: {
          type: "boolean",
          default: defaultValue,
          description: "A test boolean setting that returns undefined",
        },
      };

      const setting = new ExtensionSetting(settingId, fakeSectionTitle as any);

      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(undefined);

      const actualValue = setting.value;

      assert.strictEqual(actualValue, undefined);
      sinon.assert.calledOnceWithExactly(stubbedConfigs.get, settingId, defaultValue);
    });

    it("should handle typed settings correctly", () => {
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
      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(expectedValue);

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
      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(expectedValue);

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
      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(expectedValue);

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
      stubbedConfigs.get.withArgs(settingId, defaultValue).returns(expectedValue);

      const actualValue = setting.value;

      assert.deepStrictEqual(actualValue, expectedValue);
    });
  });
});
