import * as sinon from "sinon";
import * as vscode from "vscode";
import * as emitters from "../../src/emitters";

export type StubbedEventEmitters = Partial<
  Record<keyof typeof emitters, sinon.SinonStubbedInstance<vscode.EventEmitter<any>>>
>;
/**
 * Create stubbed instances for all event emitters defined in the `emitters` module using the provided Sinon sandbox.
 *
 * This function uses introspection to dynamically discover all properties of the `emitters` module
 * that are instances of `vscode.EventEmitter`. It then replaces their methods with Sinon stubs,
 * enabling controlled testing and verification of event emission and handler registration.
 *
 * The returned object maps each emitter name to its corresponding stubbed instance, typed as
 * `SinonStubbedInstance<vscode.EventEmitter<void>>`, for use in assertions within tests
 * proving that .event() was called with the right handler. The whole stubbed instance is returned,
 * not just the `.event()` method, allowing for more flexible testing scenarios.
 *
 * See {@link vscodeEventRegistrationStubs} for doing the equivalent for common `vscode` event handler registration functions.
 *
 * @param sandbox - The Sinon sandbox to use for creating stubs.
 * @returns An object mapping each emitter name to its corresponding stubbed instance.
 */
export function eventEmitterStubs(sandbox: sinon.SinonSandbox): StubbedEventEmitters {
  // Will be record of emitter names to their stubbed instances.
  const stubs: Record<
    keyof typeof emitters,
    sinon.SinonStubbedInstance<vscode.EventEmitter<any>>
  > = {} as any;

  // Introspect the emitters module to find all event emitters, capturing pairs of
  // emitter names and their corresponding vscode.EventEmitter instances.
  const stubEntries: Array<[keyof typeof emitters, vscode.EventEmitter<any>]> = Object.entries(
    emitters,
  ).filter(([, value]) => value instanceof vscode.EventEmitter) as Array<
    [keyof typeof emitters, vscode.EventEmitter<any>]
  >;

  // Iterate over the entries and create stubbed instances over each emitter.
  for (const [name, obj] of stubEntries) {
    const stubbedEmitter = sandbox.stub(obj);
    stubs[name] = stubbedEmitter;
  }

  return stubs;
}

/** Object containing stubbed functions for registering event handlers for various core vscode events. */
export type VscodeEventRegistrationStubs = {
  onDidOpenTextDocumentStub: sinon.SinonStub;
  onDidCloseTextDocumentStub: sinon.SinonStub;
  onDidChangeTextDocumentStub: sinon.SinonStub;
  onDidChangeActiveTextEditorStub: sinon.SinonStub;
};

/**
 * Create stubs for common `vscode` event emitter handler registration functions.
 *
 * Unlike the `eventEmitterStubs` function,
 * this function does not stub instances of `vscode.EventEmitter`, but rather stubs the methods of the `vscode.workspace` and `vscode.window`
 * modules that register handlers for various events. So, returns stubbed functions equivalent to the `.event()` method of `vscode.EventEmitter`.
 *
 * See {@link eventEmitterStubs} for stubbing all our custom emitters in the `emitters` module.
 * @param sandbox - The Sinon sandbox to use for creating stubs.
 * @returns An object containing stubs for common `vscode` event emitter handler registration functions.
 */
export function vscodeEventRegistrationStubs(
  sandbox: sinon.SinonSandbox,
): VscodeEventRegistrationStubs {
  return {
    onDidOpenTextDocumentStub: sandbox.stub(vscode.workspace, "onDidOpenTextDocument"),
    onDidCloseTextDocumentStub: sandbox.stub(vscode.workspace, "onDidCloseTextDocument"),
    onDidChangeTextDocumentStub: sandbox.stub(vscode.workspace, "onDidChangeTextDocument"),
    onDidChangeActiveTextEditorStub: sandbox.stub(vscode.window, "onDidChangeActiveTextEditor"),
  };
}
