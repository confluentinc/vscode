import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import node from "@rollup/plugin-node-resolve";
import replace from "@rollup/plugin-replace";
import virtual from "@rollup/plugin-virtual";
import { createFilter } from "@rollup/pluginutils";
import { sentryRollupPlugin } from "@sentry/rollup-plugin";
import { FontAssetType, OtherAssetType, generateFonts } from "@twbs/fantasticon";
import { runTests } from "@vscode/test-electron";
import { configDotenv } from "dotenv";
import { ESLint } from "eslint";
import { globSync } from "glob";
import { dest, parallel, series, src } from "gulp";
import libCoverage from "istanbul-lib-coverage";
import libInstrument from "istanbul-lib-instrument";
import libReport from "istanbul-lib-report";
import libSourceMaps from "istanbul-lib-source-maps";
import reports from "istanbul-reports";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { rimrafSync } from "rimraf";
import { rollup, watch } from "rollup";
import copy from "rollup-plugin-copy";
import esbuild from "rollup-plugin-esbuild";
import ts from "typescript";
configDotenv();
const DESTINATION = "out";

const IS_CI = process.env.CI != null;
const IS_WINDOWS = process.platform === "win32";
const IS_MAC = process.platform === "darwin";

export const ci = parallel(check, build, lint);
export const test = series(clean, testBuild, testRun);
export const liveTest = series(clean, build, testBuild);
liveTest.description =
  "Rebuild the out/ directory after codebase or test suite changes for live breakpoint debugging.";

export const bundle = series(clean, build, pack);

export const clicktest = series(bundle, install);

clean.description = "Clean up static assets.";
export function clean(done) {
  try {
    rimrafSync(DESTINATION);
    return done(0);
  } catch (e) {
    console.error("Failed to clean up static assets", e);
    return done(1);
  }
}

pack.description = "Create .vsix file for the extension. Make sure to pre-build assets.";
export function pack(done) {
  var vsceCommandArgs = ["vsce", "package"];
  // Check if TARGET is set, if so, add it to the command
  if (process.env.TARGET) {
    vsceCommandArgs.push("--target");
    vsceCommandArgs.push(process.env.TARGET);
  }
  const result = spawnSync("npx", vsceCommandArgs, {
    stdio: "inherit",
    cwd: DESTINATION,
    shell: IS_WINDOWS,
  });
  if (result.error) throw result.error;
  return done(result.status);
}

build.description = "Build static assets for extension and webviews. Use -w for watch mode.";
export function build(done) {
  const incremental = process.argv.indexOf("-w", 2) > -1;
  const production = process.env.NODE_ENV === "production";

  const result = downloadSidecar();
  if (result.error) throw result.error;

  if (production) {
    process.env.SENTRY_ENV = "production";
    setupSegment();
    setupSentry();
  }

  /** @type {import("rollup").RollupOptions} */
  const extInput = {
    input: {
      extension: "src/extension.ts",
      sidecar: "ide-sidecar",
    },
    plugins: [
      sidecar(),
      pkgjson(),
      node({ preferBuiltins: true, exportConditions: ["node"] }),
      commonjs(),
      json(),
      esbuild({ sourceMap: true, minify: production }),
      template({ include: ["**/*.html"] }),
      replace({
        // inline EdgeRuntime as an arbitrary string to eliminate unnecessary code for edge runtimes that sentry/segment support
        EdgeRuntime: JSON.stringify("vscode"),
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
        "process.env.SEGMENT_WRITE_KEY": JSON.stringify(process.env.SEGMENT_WRITE_KEY),
        "process.env.SENTRY_AUTH_TOKEN": JSON.stringify(process.env.SENTRY_AUTH_TOKEN),
        "process.env.SENTRY_RELEASE": JSON.stringify(process.env.SENTRY_RELEASE),
        "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN),
        "process.env.SENTRY_ENV": JSON.stringify(process.env.SENTRY_ENV),
        preventAssignment: true,
      }),
      copy({
        copyOnce: true,
        targets: [
          { src: ["resources"], dest: DESTINATION },
          {
            src: [
              "LICENSE.txt",
              "NOTICE-vsix.txt",
              "THIRD_PARTY_NOTICES.txt",
              "THIRD_PARTY_NOTICES_IDE_SIDECAR.txt",
              ".vscodeignore",
            ],
            dest: DESTINATION,
          },
          { src: ["README.md"], dest: DESTINATION },
          { src: ["CHANGELOG.md"], dest: DESTINATION },
        ],
      }),
      sentryRollupPlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: "confluent",
        project: "vscode-extension",
        release: { name: process.env.SENTRY_RELEASE },
        disable: !process.env.SENTRY_AUTH_TOKEN,
        applicationKey: "confluent-vscode-extension-sentry-do-not-use",
      }),
    ],
    onLog: handleBuildLog,
    external: ["vscode"],
    context: "globalThis",
  };
  /** @type {import("rollup").OutputOptions} */
  const extOutput = {
    dir: DESTINATION,
    format: "cjs",
    // this must be set to true for the sourcemaps to be uploaded to Sentry
    // see: https://docs.sentry.io/platforms/javascript/guides/wasm/sourcemaps/uploading/rollup/
    sourcemap: true,
    sourcemapBaseUrl: `file://${process.cwd()}/${DESTINATION}/`,
    exports: "named",
  };

  /** @type {import("rollup").RollupOptions} */
  const webInput = {
    // TODO I should probably convert this to array of configs so I isolate modules
    input: globSync("src/webview/*.ts", { ignore: "src/webview/*.spec.ts" }),
    plugins: [
      stylesheet({
        include: ["**/*.css"],
        minify: production,
      }),
      esbuild({
        sourceMap: !production,
        minify: production,
        target: "es2020",
      }),
      replace({
        "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV),
        preventAssignment: true,
      }),
      json(),
      node(),
      commonjs(),
    ],
    onLog: handleBuildLog,
    context: "globalThis",
  };
  /** @type {import("rollup").OutputOptions} */
  const webOutput = {
    dir: `${DESTINATION}/webview`,
    format: "esm",
    sourcemap: !production,
    sourcemapBaseUrl: `file://${process.cwd()}/${DESTINATION}/webview/`,
  };

  if (incremental) {
    const webview = watch({ ...webInput, output: webOutput });
    webview.on("event", ({ error, result }) => {
      if (error != null) console.error(error);
      result?.close();
    });
    webview.on("close", done).on("error", done);
    const extension = watch({ ...extInput, output: extOutput });
    extension.on("event", ({ error, result }) => {
      if (error != null) console.error(error);
      result?.close();
    });
    extension.on("close", done).on("error", done);
  } else {
    return rollup(webInput)
      .then((bundle) => bundle.write(webOutput))
      .then(() => rollup(extInput))
      .then((bundle) => bundle.write(extOutput));
  }
}

/** @type {import("rollup").LogHandlerWithDefault} */
function handleBuildLog(level, log, handler) {
  // skip log messages about circular dependencies inside node_modules
  if (log.code === "CIRCULAR_DEPENDENCY" && log.ids.every((id) => id.includes("node_modules")))
    return;
  // as well as any "The 'this' keyword is equivalent to 'undefined' at the top level of an ES module" warnings
  if (log.code === "THIS_IS_UNDEFINED" && log.id.includes("node_modules")) return;
  handler(level, log);
}

/** Used by Sentry rollup plugin during build, we need a version to identify releases in Sentry so they can line up with source map uploads
 * Combines our VSCode extension version as it appears in package.json, and adds the shortened SHA of the latest HEAD commit if not on a CI build.
 */
function getSentryReleaseVersion() {
  let version = "0.0.0";
  let revision = "noRevision";
  try {
    // add "dirty" to the revision instead of sha if there are uncommmited changes
    const isDirty =
      spawnSync("git", ["diff", "--quiet"], { stdio: "pipe", shell: IS_WINDOWS }).status !== 0;
    if (isDirty) {
      revision = "dirty";
      console.log("Using 'dirty' version suffix and setting SENTRY_ENV=development");
      process.env.SENTRY_ENV = "development";
    } else {
      revision = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
        stdio: "pipe",
        shell: IS_WINDOWS,
      })
        .stdout.toString()
        .trim();
    }
  } catch (e) {
    console.error("Failed to get revision", e);
  }

  try {
    const extensionManifest = JSON.parse(readFileSync("package.json", "utf8"));
    version = extensionManifest.version;
  } catch (e) {
    console.error("Failed to read version in package.json", e);
  }

  if (version.includes("-")) {
    // not a release version
    process.env.SENTRY_ENV = "development";
  }

  // If CI, don't use the revision since this will either be a real prod release or a manually-
  // triggered CI build (most likely from a PR that needs more click-testing)
  if (IS_CI) {
    // see https://docs.semaphoreci.com/reference/env-vars#git-branch
    const upstream = process.env.SEMAPHORE_GIT_BRANCH;
    const downstream = process.env.SEMAPHORE_GIT_WORKING_BRANCH;
    console.log(`CI build branches: Upstream: ${upstream}, Downstream: ${downstream}`);
    // see https://docs.semaphoreci.com/reference/env-vars#pr-number
    const prNumber = process.env.SEMAPHORE_GIT_PR_NUMBER;
    console.log(`CI build PR: ${prNumber}`);
    if (prNumber !== undefined) {
      // PR build (upstream branch doesn't matter since it isn't a real prod release)
      return `vscode-confluent@pr${prNumber}-${version}`;
    } else {
      // build on main or a release branch
      return "vscode-confluent@" + version;
    }
  }
  // include `dev` prefix to doubly-inform Sentry that this is not a normal prod release version
  // and doesn't follow the normal X.Y.Z semver format and accidentally match a "latest release" rule
  return "vscode-confluent@dev" + version + "-" + revision;
}

/** Get the Sentry token, dsn from Vault and get the appropriate Sentry "release" ID from the getSentryReleaseVersion, and
 * save them as env variables for access when Initiating Sentry or using the Sentry sourcemap rollup plugin
 */
function setupSentry() {
  console.log("Fetching Sentry token from Vault for sourcemaps...");
  const sentryToken = spawnSync(
    "vault",
    ["kv", "get", "-field", "SENTRY_AUTH_TOKEN", "v1/ci/kv/vscodeextension/telemetry"],
    { stdio: "pipe", shell: IS_WINDOWS },
  );
  if (sentryToken.error != null) {
    if (IS_CI) throw sentryToken.error;
    else console.error(sentryToken.error);
  } else if (sentryToken.status !== 0) {
    if (IS_CI)
      throw new Error(`Failed to fetch SENTRY_AUTH_TOKEN from Vault: ${sentryToken.stderr}`);
    else console.error(sentryToken.stderr.toString());
  } else {
    process.env.SENTRY_AUTH_TOKEN = sentryToken.stdout.toString().trim();
    const sentryRelease = getSentryReleaseVersion();
    console.log(`Setting SENTRY_RELEASE to "${sentryRelease}"`);
    process.env.SENTRY_RELEASE = sentryRelease;
  }
  const sentryDsn = spawnSync(
    "vault",
    ["kv", "get", "-field", "SENTRY_DSN", "v1/ci/kv/vscodeextension/telemetry"],
    { stdio: "pipe", shell: IS_WINDOWS },
  );
  if (sentryDsn.error != null) {
    if (IS_CI) throw sentryDsn.error;
    else console.error(sentryDsn.error);
  } else if (sentryDsn.status !== 0) {
    if (IS_CI) throw new Error(`Failed to fetch SENTRY_DSN from Vault: ${sentryDsn.stderr}`);
    else console.error(sentryDsn.stderr.toString());
  } else {
    process.env.SENTRY_DSN = sentryDsn.stdout.toString().trim();
  }
}

/** Get the Segment write key from Vault and save it as an env variable for reference in Segment setup */
function setupSegment() {
  console.log("Fetching Segment key from Vault...");
  const segmentKey = spawnSync(
    "vault",
    ["kv", "get", "-field", "SEGMENT_WRITE_KEY", "v1/ci/kv/vscodeextension/telemetry"],
    { stdio: "pipe", shell: IS_WINDOWS },
  );
  if (segmentKey.error != null) {
    if (IS_CI) throw segmentKey.error;
    else console.error(segmentKey.error);
  } else if (segmentKey.status !== 0) {
    if (IS_CI)
      throw new Error(`Failed to fetch SEGMENT_WRITE_KEY from Vault: ${segmentKey.stderr}`);
    else console.error(segmentKey.stderr.toString());
  } else {
    process.env.SEGMENT_WRITE_KEY = segmentKey.stdout.toString().trim();
  }
}

/**
 * Used by the built task, based on existing package.json, it generates
 * production-ready package.json for the extension: without any dev-related
 * keys and dependencies listing.
 */
function pkgjson() {
  return copy({
    copyOnce: true,
    targets: [
      {
        src: "package.json",
        dest: DESTINATION,
        transform(contents) {
          let pkg = JSON.parse(contents.toString());
          // add random hex suffix the version for non-CI builds to avoid caching issues
          pkg.version += process.env.CI ? "" : `+${Math.random().toString(16).slice(2, 8)}`;
          // no package.type: the bundle is CommonJS module
          delete pkg.type;
          // no dev only manifests: scripts, dependencies
          delete pkg.scripts;
          delete pkg.dependencies;
          delete pkg.devDependencies;
          // the target folder is flat so the entry point is known to be in the root
          pkg.main = "extension.js";
          return JSON.stringify(pkg, null, 2);
        },
      },
    ],
  });
}

/**
 * Bundles sidecar binary of appropriate version.
 * Provides `ide-sidecar` module for the source code to use.
 */
function sidecar() {
  const sidecarVersion = readFileSync(".versions/ide-sidecar.txt", "utf-8").replace(/[v\n\s]/g, "");
  const sidecarFilename = `ide-sidecar-${sidecarVersion}-runner${IS_WINDOWS ? ".exe" : ""}`;

  return [
    virtual({
      "ide-sidecar": `export const version = "${sidecarVersion}"; export default decodeURIComponent(new URL("./${sidecarFilename}", import.meta.url).pathname);`,
    }),
    copy({
      copyOnce: true,
      targets: [{ src: `bin/${sidecarFilename}`, dest: DESTINATION }],
    }),
  ];
}

/**
 * Enable modules to import html files as template generating functions.
 *
 * @example
 * ```html
 * <!-- template.html -->
 * <section>
 *   <p>Hello, ${name}!</p>
 * </section>
 * ```
 *
 * ```js
 * // module.js
 * import viewTemplate from "./template.html";
 *
 * document.body.innerHTML = viewTemplate({ name: "World" });
 * ```
 *
 * @returns {import("rollup").Plugin}
 */
function template(options = {}) {
  const filter = createFilter(options.include, options.exclude);
  return {
    name: "template",
    transform(code, id) {
      if (filter(id)) {
        return {
          code: `
          const template = ${JSON.stringify(code)}; 
          export default (variables) => {
            const keys = Object.keys(variables);
            const values = Object.values(variables);
            return template.replace(/\\$\\{([^}]+)\\}/g, (_, expr) => {
              // evaluate expression in { } in the context of variables
              const fn = new Function(...keys, 'return (' + expr + ');');
              return fn(...values);
            });
          }`,
          map: { mappings: "" },
        };
      }
    },
  };
}

/**
 * Basic CSS bundling plugin for Rollup. Import CSS file from JS source and it
 * will generate a CSS bundle with the same name in output folder.
 *
 * Following example will generate `styles.css` bundle (including dependencies)
 * next to the file that imported the styles file.
 *
 * @example
 * ```js
 * // main.js
 * import "./styles.css";
 * // ...
 * ```
 *
 * ```css
 * // styles.css
 * @import "some-other-styles.css"
 *
 * html {
 *   font-size: 16px;
 * }
 * body {
 *   margin: 0;
 * }
 * ```
 *
 * @returns {import("rollup").Plugin}
 */
function stylesheet(options = {}) {
  const filter = createFilter(options.include, options.exclude);
  return {
    name: "stylesheet",
    async transform(code, id) {
      if (filter(id)) {
        const { bundleAsync } = await import("lightningcss");
        const { code, dependencies } = await bundleAsync({
          filename: id,
          minify: options.minify ?? false,
          analyzeDependencies: true,
        });

        let output = code.toString();
        for (const dependency of dependencies ?? []) {
          // css files may include ?query in static dependecies
          const path = dependency.url.replace(/\?.+$/, "");
          // resolve the static file from the one requesting it
          const origin = resolve(dirname(dependency.loc.filePath), path.replace(/\?.+$/, ""));
          // putting it in the folder next to the css bundle
          const destFilename = basename(origin);
          this.emitFile({ type: "asset", fileName: destFilename, source: readFileSync(origin) });

          // lightningcss keeps a unique placeholder in the source code for bundlers to replace
          output = output.replace(dependency.placeholder, destFilename);
        }

        // css bundle is just a static asset for rollup
        this.emitFile({ type: "asset", fileName: basename(id), source: output });
        // returning an empty module so rollup doesn't try processing css
        return { code: "" };
      }
    },
  };
}

check.description = "Run TypeScript compiler to check for any type errors.";
export function check(done) {
  // Before running type checking, make sure to generate declarations for GraphQL schemas
  const precheck = spawnSync("npx", ["gql.tada", "generate-output"], {
    stdio: "ignore",
    shell: IS_WINDOWS,
  });
  if (precheck.error) throw precheck.error;

  // Entry points are the extension.ts and webview script files, but also include test files
  // so we can catch any type errors in them as well.
  const rootNames = [
    "src/extension.ts",
    ...globSync("src/**/*.test.ts"),
    ...globSync("src/webview/*.ts"),
  ];
  const defaults = ["lib.dom.d.ts", "lib.es2022.d.ts", "lib.dom.iterable.d.ts"];
  const customdts = globSync(["src/**/*.d.ts", "bin/*.d.ts"], { absolute: true });

  // The options here are similar to tsconfig.json, but don't support some fields
  const program = ts.createProgram({
    rootNames,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      lib: defaults.concat(customdts),
      skipLibCheck: true,
    },
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  // Skip type errors for client code created by openapi-generator-cli
  // NOTE: we may need to ignore `src/clients` altogether if we start getting more error codes and
  // don't have a good path forward for fixing them via the OpenAPI specs, rather than continuing to
  // grow this list of error codes to ignore.
  const skipCodesForAutoGeneratedClients = [2308, 2552];
  const filteredDiagnostics = diagnostics.filter((diagnostic) => {
    if (diagnostic.file.fileName.match(/\/src\/clients\//))
      return !skipCodesForAutoGeneratedClients.includes(diagnostic.code);
    return true;
  });

  const output = ts.formatDiagnosticsWithColorAndContext(filteredDiagnostics, {
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
    getCanonicalFileName: (v) => v,
  });
  if (output.length > 0) console.log(output);
  if (filteredDiagnostics.length > 0) {
    throw new Error(`Found ${filteredDiagnostics.length} type error(s)`);
  }
  return done(0);
}

lint.description = "Run ESLint to check lint rules and formattings. Use -f to automatically fix.";
export async function lint() {
  const fix = process.argv.indexOf("-f", 2) > -1;
  const eslint = new ESLint({ fix, cache: !IS_CI });
  const result = await eslint.lintFiles(["src", "*.{js,mjs}"]);
  if (fix) await ESLint.outputFixes(result);
  const format = await eslint.loadFormatter("stylish");
  console.log(format.format(result));
  const errorCount = result.reduce((sum, res) => sum + res.errorCount, 0);
  const warnCount = result.reduce((sum, res) => sum + res.warningCount, 0);
  if (errorCount > 0) throw new Error("ESLint found errors");
  if (warnCount > 50) throw new Error("ESLint found too many warnings (maximum: 50).");
}

testBuild.description =
  "Build test files for running tests via `gulp testRun` or through the VS Code test runner. Use --coverage to enable coverage reporting.";
export async function testBuild() {
  const reportCoverage = IS_CI || process.argv.indexOf("--coverage", 2) >= 0;
  const testFiles = globSync(["src/**/*.test.ts", "src/testing.ts"]);
  const entryMap = Object.fromEntries(
    testFiles.map((filename) => [filename.slice(0, -extname(filename).length), filename]),
  );
  /** @type {import("rollup").RollupOptions} */
  const testInput = {
    input: {
      ...entryMap,
      extension: "src/extension.ts",
      sidecar: "ide-sidecar",
    },
    plugins: [
      sidecar(),
      pkgjson(),
      node({ preferBuiltins: true, exportConditions: ["node"] }),
      commonjs(),
      esbuild({ sourceMap: true, minify: false }),
      template({ include: ["**/*.html"] }),
      json(),
      coverage({
        enabled: reportCoverage,
        include: ["src/**/*.ts"],
        exclude: [/node_modules/, /\.test.ts$/, /src\/clients/],
      }),
    ],
    onLog: handleBuildLog,
    external: ["vscode", "assert", "winston", "mocha", "@playwright/test", "dotenv", "glob"],
  };
  /** @type {import("rollup").OutputOptions} */
  const testOutput = {
    dir: DESTINATION,
    format: "cjs",
    sourcemap: true,
    preserveModules: true,
    exports: "named",
  };
  const bundle = await rollup(testInput);
  await bundle.write(testOutput);
  return 0;
}

testRun.description = "Run tests using @vscode/test-cli. Use --coverage for coverage report.";
export async function testRun() {
  const reportCoverage = IS_CI || process.argv.indexOf("--coverage", 2) >= 0;
  // argv array is something like ['gulp', 'test', '-t', 'something'], we look for the one after -t
  const testFilter = process.argv.find((v, i, a) => i > 0 && a[i - 1] === "-t");

  // adjust the launch arguments depending on the environment
  const launchArgs = [];
  if (IS_CI && IS_MAC) {
    launchArgs.push("--disable-gpu", "--disable-extensions", "--disable-telemetry");
  } else {
    launchArgs.push(
      "--no-sandbox",
      "--profile-temp",
      "--skip-release-notes",
      "--skip-welcome",
      "--disable-gpu",
      "--disable-chromium-sandbox",
      "--disable-updates",
      "--disable-workspace-trust",
      "--disable-extensions",
    );
  }

  await runTests({
    version: process.env.VSCODE_VERSION,
    extensionDevelopmentPath: resolve(DESTINATION),
    extensionTestsPath: resolve(DESTINATION + "/src/testing.js"),
    extensionTestsEnv: {
      // used by https://mochajs.org/api/mocha#fgrep for running isolated tests
      FGREP: testFilter,
      // additional environment variables for macOS in CI for headless mode
      ...(IS_CI &&
        IS_MAC && {
          ELECTRON_ENABLE_LOGGING: "true",
          ELECTRON_ENABLE_STACK_DUMPING: "true",
          ELECTRON_NO_ATTACH_CONSOLE: "true",
          ELECTRON_NO_SANDBOX: "1",
          VSCODE_CLI: "1",
          ELECTRON_RUN_AS_NODE: "1",
        }),
    },
    launchArgs,
  });

  if (reportCoverage) {
    let coverageMap = libCoverage.createCoverageMap();
    let sourceMapStore = libSourceMaps.createSourceMapStore();
    coverageMap.merge(JSON.parse(await readFile("./coverage.json")));
    let data = await sourceMapStore.transformCoverage(coverageMap);
    let report = IS_CI ? reports.create("lcov") : reports.create("text", {});
    let context = libReport.createContext({ coverageMap: data });
    report.execute(context);
    // create interactive HTML report for local runs
    let htmlReport = reports.create("html", {
      dir: "./coverage/html",
      verbose: true,
    });
    htmlReport.execute(context);
    // clean up temp file used for coverage reporting
    await unlink("./coverage.json");
  }
  // runTests() will throw an error if tests failed, otherwise report happy execution
  return 0;
}

/**
 * Instruments TS/JS code with istanbul. Coverage data stored to `global.__coverage__`.
 *
 * @returns {import("rollup").Plugin}
 */
function coverage(options) {
  let filter = createFilter(options?.include, options?.exclude);
  return {
    name: "coverage",
    transform(code, id) {
      if (!options.enabled || !filter(id)) return;
      let instrumenter = libInstrument.createInstrumenter();
      let sourceMaps = this.getCombinedSourcemap();
      let instrumentedCode = instrumenter.instrumentSync(code, id, sourceMaps);
      return { code: instrumentedCode, map: instrumenter.lastSourceMap() };
    },
  };
}

export function functional(done) {
  const result = spawnSync("npx", ["playwright", "test"], { stdio: "inherit", shell: IS_WINDOWS });
  if (result.error) throw result.error;
  return done(result.status);
}

async function applyOpenAPISpecPatches(patchDir) {
  const patchFiles = globSync(`${patchDir}/*.patch`);
  for (const patch of patchFiles) {
    console.log(`Applying patch from "${patch}"...`);
    const result = spawnSync("git", ["apply", patch], {
      stdio: "pipe",
      shell: IS_WINDOWS,
      encoding: "utf-8",
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.log(result.stderr.trim());
      if (result.stderr?.includes("patch does not apply")) {
        // patch was already applied, nothing to do
        console.log(`⏩ Skipping patch "${patch}"`);
        continue;
      }
      throw new Error(`❌ Failed to apply patch from "${patch}"`);
    }
    console.log(`✅ Successfully applied patch from "${patch}"`);
  }
}

apigen.description = "Generate API clients from OpenAPI specs.";
export async function apigen() {
  // make any necessary changes to the OpenAPI specs before generating client code
  await applyOpenAPISpecPatches("src/clients/sidecar-openapi-specs/patches");

  // Lock down the version of openapi-generator to avoid breaking changes or surprises
  // per https://openapi-generator.tech/docs/installation/
  const openapiGeneratorVersion = "7.10.0";

  const lockResult = spawnSync(
    "npx",
    ["openapi-generator-cli", "version-manager", "set", openapiGeneratorVersion],
    { stdio: "inherit", shell: IS_WINDOWS },
  );
  if (lockResult.error) throw lockResult.error;
  if (lockResult.status !== 0)
    throw new Error(`Failed to lock openapi-generator version to ${openapiGeneratorVersion}`);

  // On to generating all our clients from the multiple OpenAPI specs
  const clients = [
    ["src/clients/sidecar-openapi-specs/sidecar.openapi.yaml", "src/clients/sidecar"],
    ["src/clients/sidecar-openapi-specs/ce-kafka-rest.openapi.yaml", "src/clients/kafkaRest"],
    [
      "src/clients/sidecar-openapi-specs/schema-registry.openapi.yaml",
      "src/clients/schemaRegistryRest",
    ],
    [
      "src/clients/sidecar-openapi-specs/scaffolding-service.openapi.yaml",
      "src/clients/scaffoldingService",
    ],
    ["src/clients/docker.openapi.yaml", "src/clients/docker"],
  ];

  // other configs here: https://openapi-generator.tech/docs/generators/typescript-fetch/#config-options
  const additionalProperties = {
    modelPropertyNaming: "original",
    paramNaming: "original",
  };
  // join key-value pairs into a string `key1=value1,key2=value2,...`
  const additionalPropertiesString = Object.entries(additionalProperties)
    .map(([key, value]) => `${key}=${value}`)
    .join(",");

  const format = await prettier();

  for (const [spec, path] of clients) {
    // other client generator types: https://openapi-generator.tech/docs/generators#client-generators
    const result = spawnSync(
      "npx",
      [
        "openapi-generator-cli",
        "generate",
        "-i",
        spec,
        "-g",
        "typescript-fetch",
        "-o",
        path,
        "--additional-properties",
        additionalPropertiesString,
      ],
      {
        stdio: "inherit",
        shell: IS_WINDOWS,
      },
    );
    // apply prettier formatting to generated code
    await pipeline(
      src(join(path, "**", "*.ts")),
      format,
      dest((file) => file.base),
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Failed to generate client for ${spec}`);
  }
}

format.description = "Enforce Prettier formatting for all TS/JS/MD/HTML/YAML files.";
export async function format() {
  const transform = await prettier();
  // Prettier's API does not have a magic method to just fix everything
  // So this is where we add some Gulp FileSystem API to make it work
  return pipeline(
    src([
      "src/**/*.ts",
      "src/**/*.css",
      "src/**/*.html",
      "src/**/*.json",
      "src/**/*.graphql",
      "*.md",
      "*.js",
      "src/clients/sidecar-openapi-specs/*.yaml",
    ]),
    transform,
    dest((file) => file.base),
  );
}

async function prettier() {
  const { check, format, resolveConfigFile, resolveConfig } = await import("prettier");
  const file = (await resolveConfigFile()) ?? ".prettierrc";
  const config = await resolveConfig(file);
  /** @param {AsyncIterator<import("vinyl")>} source */
  return async function* process(source) {
    for await (const file of source) {
      if (file.contents != null) {
        const options = { filepath: file.path, ...config };
        const code = file.contents.toString();
        const valid = await check(code, options);
        if (!valid) {
          const contents = await format(code, options);
          const clone = file.clone({ contents: false });
          yield Object.assign(clone, { contents: Buffer.from(contents) });
        }
      }
    }
  };
}

icongen.description = "Generate font files from SVG icons, and update package.json accordingly.";
export async function icongen() {
  const result = await generateFonts({
    name: "icons",
    prefix: "confluenticon",
    inputDir: "./resources/icons",
    outputDir: "./resources/dist",
    fontTypes: [FontAssetType.WOFF2],
    assetTypes: [OtherAssetType.HTML, OtherAssetType.JSON],
    formatOptions: {},
    templates: {
      html: "./resources/icons/template/icons-contribution.hbs",
    },
    pathOptions: {},
    codepoints: {},
    fontHeight: 1000,
    round: undefined,
    descent: undefined, // Will use `svgicons2svgfont` defaults
    normalize: true, // if this is `undefined`, we may get wildly different icon sizes in the font
    selector: null,
    tag: "i",
    fontsUrl: "#{root}/dist",
  });
  if (result.error) throw result.error;

  // NOTE: there doesn't seem to be a way to generate the `contributes.icons` block using the
  // mustache templates in `./resources/templates`, so we end up creating an "HTML" file that's
  // really just JSON in the format we need it to be.
  // With that JSON-in-HTML hack, we can update the package.json with the generated icons.
  const html = result.assetsOut.html;
  if (html == null) throw new Error("Failed to find generated HTML file");
  const iconContributions = JSON.parse(html);
  // read package.json, add the `contributes.icons` section, then write it back
  const extensionManifestString = await readFile("package.json", "utf8");
  const extensionManifest = JSON.parse(extensionManifestString);
  extensionManifest.contributes.icons = iconContributions.icons;
  await writeFile("package.json", JSON.stringify(extensionManifest, null, 2), "utf8");
  await appendFile("package.json", "\n", "utf8");
}

install.description = "Install the extension in VS Code for testing.";
export function install(done) {
  if (IS_CI) {
    console.error("This is meant to be run locally and should not be used in CI.");
    return done(1);
  }
  // uninstall any existing extension first
  // (may holler about "Extension 'confluentinc.vscode-confluent' is not installed.", but that's fine)
  spawnSync("code", ["--uninstall-extension", "confluentinc.vscode-confluent"], {
    stdio: "inherit",
    shell: IS_WINDOWS,
  });

  const files = globSync("out/*.vsix");
  if (files.length === 0) {
    console.error(
      "No .vsix files found in the out directory. Make sure to run `gulp bundle` first.",
    );
    return done(1);
  }

  const extensionVsix = files[0];
  if (files.length > 1) {
    console.warn(
      `Multiple .vsix files found in the out directory. Only installing "${extensionVsix}"`,
    );
  }
  // "--install-extension: Installs or updates an extension. The argument is either an extension id
  // or a path to a VSIX. The identifier of an extension is '${publisher}.${name}'. Use '--force'
  // argument to update to latest version. To install a specific version provide '@${version}'.
  // For example: 'vscode.csharp@1.2.3'."
  const result = spawnSync("code", ["--install-extension", extensionVsix], {
    stdio: "inherit",
    shell: IS_WINDOWS,
  });
  return done(result.status);
}

export async function downloadSidecar() {
  let result;
  if (IS_WINDOWS) {
    result = spawnSync(
      "powershell.exe",
      // Add "-ExecutionPolicy", "Bypass" if necessary
      ["-ExecutionPolicy", "Bypass", "-File", "./scripts/windows/download-sidecar-executable.ps1"],
      { stdio: "inherit", shell: IS_WINDOWS },
    );
  } else {
    // Use the make target to download the sidecar executable
    result = spawnSync("make", ["download-sidecar-executable"], {
      stdio: "inherit",
      shell: IS_WINDOWS,
    });
  }

  return result;
}
