import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { ContainerSummary, Port, PortTypeEnum } from "../clients/docker";
import {
  DatasetDTO,
  EventDTO,
  FieldDTO,
  GenerationDTO,
  GenerationDTOGeneratorEnum,
  ResponseError,
  SchemaManagementApi,
} from "../clients/medusa";
import * as medusaApi from "../medusa/api";
import * as localConnections from "../sidecar/connections/local";
import * as fileUtils from "../utils/file";
import * as fsWrappers from "../utils/fsWrappers";
import * as commands from "./index";
import {
  generateMedusaDatasetCommand,
  MEDUSA_COMMANDS,
  registerMedusaCodeLensCommands,
} from "./medusaCodeLens";

describe("medusaCodeLens", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("generateMedusaDatasetCommand", () => {
    let mockUri: vscode.Uri;
    let getEditorOrFileContentsStub: sinon.SinonStub;
    let withProgressStub: sinon.SinonStub;
    let showInformationMessageStub: sinon.SinonStub;
    let showErrorMessageStub: sinon.SinonStub;
    let showSaveDialogStub: sinon.SinonStub;
    let writeFileStub: sinon.SinonStub;
    let showTextDocumentStub: sinon.SinonStub;
    let getMedusaSchemaManagementApiStub: sinon.SinonStub;
    let getMedusaContainerStub: sinon.SinonStub;
    let getContainerPublicPortStub: sinon.SinonStub;
    let mockSchemaManagementApi: sinon.SinonStubbedInstance<SchemaManagementApi>;

    const validAvroSchema = {
      type: "record",
      name: "TestRecord",
      fields: [
        { name: "id", type: "string" },
        { name: "value", type: "int" },
      ],
    };

    const mockFieldGeneration: GenerationDTO = {
      generator: GenerationDTOGeneratorEnum.StringUuid,
      arguments: [],
    };

    const mockFields: FieldDTO[] = [
      {
        name: "id",
        generation: mockFieldGeneration,
        ignored: false,
      },
      {
        name: "value",
        generation: {
          generator: GenerationDTOGeneratorEnum.NumberIteratingInteger,
          arguments: [],
        },
        ignored: false,
      },
    ];

    const mockEvent: EventDTO = {
      event_name: "TestEvent",
      key_field_name: "id",
      fields: mockFields,
    };

    const mockDataset: DatasetDTO = {
      events: [mockEvent],
      tables: [],
    };

    beforeEach(() => {
      mockUri = vscode.Uri.file("/path/to/test.avsc");

      getEditorOrFileContentsStub = sandbox
        .stub(fileUtils, "getEditorOrFileContents")
        .resolves({ content: JSON.stringify(validAvroSchema) });
      withProgressStub = sandbox.stub(vscode.window, "withProgress");
      showInformationMessageStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();
      showErrorMessageStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();
      showSaveDialogStub = sandbox.stub(vscode.window, "showSaveDialog");
      writeFileStub = sandbox.stub(fsWrappers, "writeFile").resolves();
      showTextDocumentStub = sandbox.stub(vscode.window, "showTextDocument").resolves();

      // Mock workspace folders
      const mockWorkspaceFolder = {
        uri: vscode.Uri.file("/workspace"),
        name: "test-workspace",
        index: 0,
      };
      sandbox.stub(vscode.workspace, "workspaceFolders").value([mockWorkspaceFolder]);

      // Mock the Medusa API
      mockSchemaManagementApi = sandbox.createStubInstance(SchemaManagementApi);
      getMedusaSchemaManagementApiStub = sandbox
        .stub(medusaApi, "getMedusaSchemaManagementApi")
        .returns(mockSchemaManagementApi);

      // Mock the container functions
      const mockPort: Port = {
        PrivatePort: 8082,
        PublicPort: 8082,
        Type: PortTypeEnum.Tcp,
      };
      const mockContainer: ContainerSummary = {
        Id: "mock-container",
        Ports: [mockPort],
      };
      getMedusaContainerStub = sandbox
        .stub(localConnections, "getMedusaContainer")
        .resolves(mockContainer);
      getContainerPublicPortStub = sandbox
        .stub(localConnections, "getContainerPublicPort")
        .withArgs(mockContainer)
        .returns(8082);
    });

    it("should successfully generate dataset and save to file", async () => {
      // Setup mocks
      mockSchemaManagementApi.convertAvroSchemaToDataset.resolves(mockDataset);
      withProgressStub.callsFake(async (options, callback) => await callback());
      showSaveDialogStub.resolves(vscode.Uri.file("/workspace/TestEvent.dataset.json"));
      showInformationMessageStub.resolves("Open File");

      await generateMedusaDatasetCommand(mockUri);

      // Verify file reading
      sinon.assert.calledOnceWithExactly(getEditorOrFileContentsStub, mockUri);

      // Verify container functions called
      sinon.assert.calledOnce(getMedusaContainerStub);
      sinon.assert.calledOnce(getContainerPublicPortStub);

      // Verify API call
      sinon.assert.calledOnceWithExactly(getMedusaSchemaManagementApiStub, 8082);
      sinon.assert.calledOnceWithExactly(
        mockSchemaManagementApi.convertAvroSchemaToDataset,
        sinon.match({ body: validAvroSchema }),
      );

      // Verify progress dialog
      sinon.assert.calledOnce(withProgressStub);
      const progressOptions = withProgressStub.getCall(0).args[0];
      assert.strictEqual(progressOptions.title, "Generating Medusa Dataset...");

      // Verify success message (should be called once for file save)
      sinon.assert.calledOnce(showInformationMessageStub);
      sinon.assert.calledWithMatch(
        showInformationMessageStub,
        /Medusa Dataset saved to.*\.dataset\.json/,
      );

      // Verify save dialog
      sinon.assert.calledOnce(showSaveDialogStub);
      const saveOptions = showSaveDialogStub.getCall(0).args[0];
      assert.deepStrictEqual(saveOptions.filters, { "Medusa Dataset Files": ["dataset.json"] });

      // Verify file write
      sinon.assert.calledOnce(writeFileStub);
      const [savedUri, savedContent] = writeFileStub.getCall(0).args;
      const expectedUri = vscode.Uri.file("/workspace/TestEvent.dataset.json");
      assert.strictEqual(savedUri.path, expectedUri.path);
      const savedData = JSON.parse(savedContent.toString());
      assert.deepStrictEqual(savedData, mockDataset);

      // Verify file opened
      sinon.assert.calledOnce(showTextDocumentStub);
    });

    it("should handle empty file error", async () => {
      getEditorOrFileContentsStub.resolves({ content: "" });

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledOnceWithExactly(showErrorMessageStub, "The Avro schema file is empty.");
      sinon.assert.notCalled(withProgressStub);
    });

    it("should handle invalid JSON error", async () => {
      getEditorOrFileContentsStub.resolves({ content: "{ invalid json" });
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: Invalid JSON in Avro schema file/,
      );
      sinon.assert.notCalled(mockSchemaManagementApi.convertAvroSchemaToDataset);
    });

    it("should handle API error", async () => {
      const apiError = new Error("API connection failed");
      mockSchemaManagementApi.convertAvroSchemaToDataset.rejects(apiError);
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: API connection failed/,
      );
      sinon.assert.notCalled(showSaveDialogStub);
    });

    it("should handle Medusa ResponseError with JSON body", async () => {
      const mockResponse = new Response(
        JSON.stringify({ message: "Invalid Avro schema: field 'name' is required" }),
      );
      const responseError = new ResponseError(mockResponse, "Response returned an error code");
      mockSchemaManagementApi.convertAvroSchemaToDataset.rejects(responseError);
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: Medusa API error: Invalid Avro schema: field 'name' is required/,
      );
      sinon.assert.notCalled(showSaveDialogStub);
    });

    it("should handle Medusa ResponseError with text body", async () => {
      const mockResponse = new Response("Service temporarily unavailable");
      const responseError = new ResponseError(mockResponse, "Response returned an error code");
      mockSchemaManagementApi.convertAvroSchemaToDataset.rejects(responseError);
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: Medusa API error: Service temporarily unavailable/,
      );
      sinon.assert.notCalled(showSaveDialogStub);
    });

    it("should handle user canceling save dialog", async () => {
      mockSchemaManagementApi.convertAvroSchemaToDataset.resolves(mockDataset);
      withProgressStub.callsFake(async (options, task) => await task());
      showSaveDialogStub.resolves(undefined); // User canceled

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledOnce(showSaveDialogStub);
      sinon.assert.notCalled(writeFileStub);
    });

    [
      "/workspace/myfile.json",
      "/workspace/myfile",
      "/workspace/myfile.txt",
      "/workspace/myfile.dataset",
    ].forEach((inputPath) => {
      it(`should enforce .dataset.json extension for file name input '${inputPath}'`, async () => {
        mockSchemaManagementApi.convertAvroSchemaToDataset.resolves(mockDataset);
        withProgressStub.callsFake(async (options, task) => await task());
        showSaveDialogStub.resolves(vscode.Uri.file(inputPath));

        await generateMedusaDatasetCommand(mockUri);

        const [savedUri] = writeFileStub.getCall(0).args;
        const expectedUri = vscode.Uri.file("/workspace/myfile.dataset.json");
        assert.strictEqual(savedUri.path, expectedUri.path);
      });
    });

    it("should handle file write error", async () => {
      mockSchemaManagementApi.convertAvroSchemaToDataset.resolves(mockDataset);
      withProgressStub.callsFake(async (options, task) => await task());
      showSaveDialogStub.resolves(vscode.Uri.file("/workspace/test.dataset.json"));
      writeFileStub.rejects(new Error("Permission denied"));

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to save dataset file: Permission denied/,
      );
    });

    it("should not open file when user doesn't click 'Open File'", async () => {
      mockSchemaManagementApi.convertAvroSchemaToDataset.resolves(mockDataset);
      withProgressStub.callsFake(async (options, task) => await task());
      showSaveDialogStub.resolves(vscode.Uri.file("/workspace/test.dataset.json"));
      showInformationMessageStub.resolves(undefined); // User didn't click "Open File"

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.notCalled(showTextDocumentStub);
    });

    it("should handle missing Medusa container error", async () => {
      getMedusaContainerStub.resolves(undefined); // No container found
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: Medusa container not found. Please start the local Medusa service./,
      );
      sinon.assert.notCalled(getContainerPublicPortStub);
      sinon.assert.notCalled(mockSchemaManagementApi.convertAvroSchemaToDataset);
    });

    it("should handle missing container port error", async () => {
      const containerWithoutPorts: ContainerSummary = {
        Id: "mock-container",
        Ports: [], // No ports
      };
      getMedusaContainerStub.resolves(containerWithoutPorts);
      getContainerPublicPortStub.withArgs(containerWithoutPorts).returns(undefined);
      withProgressStub.callsFake(async (options, callback) => await callback());

      await generateMedusaDatasetCommand(mockUri);

      sinon.assert.calledWithMatch(
        showErrorMessageStub,
        /Failed to generate Medusa dataset: Medusa container port not accessible. Please check container configuration./,
      );
      sinon.assert.notCalled(mockSchemaManagementApi.convertAvroSchemaToDataset);
    });
  });

  describe("registerMedusaCodeLensCommands", () => {
    it("should register the generateDataset command", () => {
      const registerCommandWithLoggingStub = sandbox
        .stub(commands, "registerCommandWithLogging")
        .returns({} as vscode.Disposable);

      registerMedusaCodeLensCommands();

      sinon.assert.calledOnce(registerCommandWithLoggingStub);
      sinon.assert.calledWithExactly(
        registerCommandWithLoggingStub,
        MEDUSA_COMMANDS.GENERATE_DATASET,
        generateMedusaDatasetCommand,
      );
    });
  });
});
