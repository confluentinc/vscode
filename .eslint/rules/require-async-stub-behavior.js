/**
 * Custom ESLint rule to ensure async method stubs have .resolves() or .rejects()
 *
 * This rule detects patterns like:
 * - sandbox.stub(module, "asyncMethod")
 * - sinon.stub(module, "asyncMethod")
 *
 * And flags them if the method is async (has async keyword, returns Promise, etc.)
 * but doesn't have .resolves() or .rejects() chained
 */

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require async method stubs to have .resolves() or .rejects()",
      category: "Best Practices",
      recommended: true,
    },
    fixable: undefined,
    schema: [], // No options needed anymore
    messages: {
      missingAsyncBehavior:
        "Async method stub '{{methodName}}' should have `.resolves()`, `.rejects()`, or `.callsFake()` to define its behavior, even if individual tests set it up differently",
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();

    function findFunctionDeclaration(objectName, methodName, node) {
      // Get the scope where this stub is being called
      const scope = sourceCode.getScope ? sourceCode.getScope(node) : context.getScope();

      // Look through all scopes to find the function/method declaration
      let currentScope = scope;
      while (currentScope) {
        // Check variables in current scope
        for (const variable of currentScope.variables) {
          if (variable.name === objectName) {
            // Found the object, now look for method definitions
            for (const def of variable.defs) {
              if (def.node && def.node.type === "VariableDeclarator" && def.node.init) {
                const init = def.node.init;
                if (init.type === "ObjectExpression") {
                  // Look for method in object literal
                  const method = init.properties.find(
                    (prop) => prop.key && prop.key.name === methodName,
                  );
                  if (method) {
                    return method.value;
                  }
                }
              }
            }
          }
        }
        currentScope = currentScope.upper;
      }

      return null;
    }

    function checkTypeScriptReturnType(objectName, methodName, node) {
      // Try to use TypeScript parser services if available
      const parserServices = context.getSourceCode().parserServices;

      if (!parserServices || !parserServices.program || !parserServices.esTreeNodeToTSNodeMap) {
        return false;
      }

      try {
        const checker = parserServices.program.getTypeChecker();
        const tsNode = parserServices.esTreeNodeToTSNodeMap.get(node);

        if (!tsNode || !checker) {
          return false;
        }

        // Get the type of the first argument (the object being stubbed)
        if (node.arguments.length >= 1) {
          const objectArg = node.arguments[0];
          const objectTsNode = parserServices.esTreeNodeToTSNodeMap.get(objectArg);

          if (objectTsNode) {
            const type = checker.getTypeAtLocation(objectTsNode);

            // Try to get the method from the type
            const methodSymbol = type.getProperty(methodName);

            if (methodSymbol && methodSymbol.valueDeclaration) {
              const methodType = checker.getTypeOfSymbolAtLocation(
                methodSymbol,
                methodSymbol.valueDeclaration,
              );

              // Check if the return type is a Promise
              if (methodType.getCallSignatures().length > 0) {
                const returnType = methodType.getCallSignatures()[0].getReturnType();
                const returnTypeString = checker.typeToString(returnType);

                // Check if return type is Promise-related
                const isPromise =
                  returnTypeString.includes("Promise") ||
                  returnTypeString.includes("PromiseLike") ||
                  returnType.symbol?.name === "Promise";

                return isPromise;
              }
            }
          }
        }
      } catch (error) {
        // TypeScript analysis failed, continue with other methods
      }

      return false;
    }

    function isAsyncFunction(node) {
      if (!node) return false;

      // Check if it's an async function
      if (node.async === true) {
        return true;
      }

      // Check if it's a function that returns a Promise
      if (
        node.type === "FunctionExpression" ||
        node.type === "FunctionDeclaration" ||
        node.type === "ArrowFunctionExpression"
      ) {
        // Look for Promise return types in JSDoc or explicit Promise returns
        const comments = sourceCode.getCommentsBefore ? sourceCode.getCommentsBefore(node) : [];
        for (const comment of comments) {
          if (comment.value.includes("@returns") && comment.value.includes("Promise")) {
            return true;
          }
          if (comment.value.includes("@return") && comment.value.includes("Promise")) {
            return true;
          }
        }

        // Check if the function body returns a Promise
        if (node.body && node.body.type === "BlockStatement") {
          return hasPromiseReturn(node.body);
        } else if (node.body && node.body.type !== "BlockStatement") {
          // Arrow function with expression body
          return isPromiseExpression(node.body);
        }
      }

      return false;
    }

    function hasPromiseReturn(blockStatement) {
      for (const statement of blockStatement.body) {
        if (statement.type === "ReturnStatement" && statement.argument) {
          if (isPromiseExpression(statement.argument)) {
            return true;
          }
        }
      }
      return false;
    }

    function isPromiseExpression(node) {
      if (!node) return false;

      // Check for Promise constructor calls
      if (node.type === "NewExpression" && node.callee && node.callee.name === "Promise") {
        return true;
      }

      // Check for Promise static methods
      if (
        node.type === "CallExpression" &&
        node.callee &&
        node.callee.type === "MemberExpression"
      ) {
        if (node.callee.object && node.callee.object.name === "Promise") {
          const methodName = node.callee.property && node.callee.property.name;
          if (["resolve", "reject", "all", "race", "allSettled"].includes(methodName)) {
            return true;
          }
        }
      }

      // Check for method calls that commonly return Promises
      if (
        node.type === "CallExpression" &&
        node.callee &&
        node.callee.type === "MemberExpression"
      ) {
        const methodName = node.callee.property && node.callee.property.name;
        if (["then", "catch", "finally"].includes(methodName)) {
          return true;
        }
      }

      return false;
    }

    function hasAsyncBehavior(node) {
      // Check if this stub call is part of a method chain that includes async behavior
      let current = node.parent;

      // Walk up the AST to find if we're in a chained expression
      while (current) {
        if (current.type === "MemberExpression") {
          // Check if this member expression has an async behavior method
          if (
            current.property &&
            current.property.type === "Identifier" &&
            (current.property.name === "resolves" ||
              current.property.name === "rejects" ||
              current.property.name === "callsFake" ||
              current.property.name === "returns" ||
              current.property.name === "throws")
          ) {
            return true;
          }
          current = current.parent;
        } else if (current.type === "CallExpression") {
          // If we're in a call expression, check its callee for method chaining
          if (current.callee && current.callee.type === "MemberExpression") {
            const methodName =
              current.callee.property &&
              current.callee.property.type === "Identifier" &&
              current.callee.property.name;
            if (
              methodName === "resolves" ||
              methodName === "rejects" ||
              methodName === "callsFake" ||
              methodName === "returns" ||
              methodName === "throws"
            ) {
              return true;
            }
          }
          current = current.parent;
        } else if (
          current.type === "VariableDeclarator" ||
          current.type === "AssignmentExpression"
        ) {
          // Stop at variable declaration/assignment - this is where the chain ends
          break;
        } else {
          current = current.parent;
        }
      }

      return false;
    }

    return {
      CallExpression(node) {
        // Check for sandbox.stub() or sinon.stub() patterns
        if (
          node.callee.type === "MemberExpression" &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "stub" &&
          node.arguments.length >= 2
        ) {
          const objectArg = node.arguments[0];
          const methodNameArg = node.arguments[1];

          // Extract method name from string literal
          if (methodNameArg.type === "Literal" && typeof methodNameArg.value === "string") {
            const methodName = methodNameArg.value;

            // Try to find the actual function declaration
            let objectName = null;
            if (objectArg.type === "Identifier") {
              objectName = objectArg.name;
            }

            // Look for the function declaration to check if it's async
            const funcDeclaration = objectName
              ? findFunctionDeclaration(objectName, methodName, node)
              : null;

            // Check if it's async based on function declaration or TypeScript type information
            const isAsyncFromDeclaration = funcDeclaration && isAsyncFunction(funcDeclaration);
            const isAsyncFromTypeScript =
              objectName && checkTypeScriptReturnType(objectName, methodName, node);

            if ((isAsyncFromDeclaration || isAsyncFromTypeScript) && !hasAsyncBehavior(node)) {
              context.report({
                node: methodNameArg,
                messageId: "missingAsyncBehavior",
                data: {
                  methodName: methodName,
                },
              });
            }
          }
        }
      },
    };
  },
};

export default rule;
