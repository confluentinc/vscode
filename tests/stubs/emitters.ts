import * as sinon from "sinon";
import * as vscode from "vscode";
import * as emitters from "../../src/emitters";

export type StubbedEventEmitters = Partial<
  Record<keyof typeof emitters, sinon.SinonStubbedInstance<vscode.EventEmitter<void>>>
>;
/**
 * Stubs all event emitters defined in the `emitters` module using the provided Sinon sandbox.
 *
 * This function uses introspection to dynamically discover all properties of the `emitters` module
 * that are instances of `vscode.EventEmitter`. It then replaces their methods with Sinon stubs,
 * enabling controlled testing and verification of event emission and handler registration.
 *
 * The returned object maps each emitter name to its corresponding stubbed instance, typed as
 * `SinonStubbedInstance<vscode.EventEmitter<void>>`, for use in assertions within tests
 * proving that .event() was called with the right handler.
 *
 * @param sandbox - The Sinon sandbox to use for creating stubs.
 * @returns An object mapping each emitter name to its corresponding stubbed instance.
 */
export function eventEmitterStubs(sandbox: sinon.SinonSandbox): StubbedEventEmitters {
  // Will be record of emitter names to their stubbed instances.
  const stubs: Record<
    keyof typeof emitters,
    sinon.SinonStubbedInstance<vscode.EventEmitter<void>>
  > = {} as any;

  // Introspect the emitters module to find all event emitters, capturing pairs of
  // emitter names and their corresponding vscode.EventEmitter instances.
  const stubEntries: Array<[keyof typeof emitters, vscode.EventEmitter<any>]> = Object.entries(
    emitters,
  ).filter(([, value]) => value instanceof vscode.EventEmitter) as Array<
    [keyof typeof emitters, vscode.EventEmitter<void>]
  >;

  // Iterate over the entries and create stubbed instances over each emitter.
  for (const [name, obj] of stubEntries) {
    const stubbedEmitter = sandbox.stub(obj);
    stubs[name] = stubbedEmitter;
  }

  return stubs;
}
