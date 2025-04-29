# Testing

This VS Code extension use the Mocha BDD interface and the "sinon" and "assert" packages for
testing.

Always use a `SinonSandbox` instance when setting up stubs, spies, or fakes to ensure proper
cleanup. Use the sinon Assert API for assertions involving the behavior of stubs, spies, or fakes.
(For example, use `sinon.assert.called(stub)` instead of
`assert.equal(stub.called, true, "stub should be called, but wasn't")`.) This allows for more
concise code and provides better feedback in case of test failures.

When working with a class instance where methods need to be stubbed, use the
`sandbox.createStubInstance(ClassNameHere)` method to create a `SinonStubbedInstance` of the class.
This will ensure that all methods are stubbed and that the instance behaves like a real instance of
the class.

Fixtures are in the `test/unit/testResources` directory and represent instances of our data models
in `src/models` solely used for test purposes. Use these fixtures as needed, only creating new
instances when slight variations are necessary or a when a fixture is missing entirely.
