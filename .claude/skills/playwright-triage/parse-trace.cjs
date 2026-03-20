#!/usr/bin/env node

// parse-trace.cjs - extract structured action data from Playwright trace files
//
// Usage:
//   node parse-trace.cjs <trace.zip>       # auto-extracts to temp dir
//   node parse-trace.cjs <trace.trace>     # reads NDJSON directly
//
// Output: numbered list of actions with status, API name, selector, and error.

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");

function usage() {
  console.error("Usage: node parse-trace.cjs <trace.zip | trace.trace>");
  process.exit(1);
}

/** Resolve the input path to a trace.trace NDJSON file, extracting from zip if needed. */
function resolveTracePath(input) {
  const resolved = path.resolve(input);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  if (resolved.endsWith(".zip")) {
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "trace-"));
    execFileSync("unzip", ["-q", "-o", resolved, "-d", tmpDir]);
    const traceFile = path.join(tmpDir, "trace.trace");
    if (!fs.existsSync(traceFile)) {
      console.error(`trace.trace not found inside ${input}`);
      process.exit(1);
    }
    return { tracePath: traceFile, tmpDir };
  }

  return { tracePath: resolved, tmpDir: null };
}

/** Derive a concise API label from the class and method fields. */
function apiLabel(entry) {
  const cls = entry.class || "";
  const method = entry.method || "";

  // special-case common Playwright internal method names to be more readable
  if (method === "waitForEventInfo") return "page.waitForLoadState";
  if (method === "waitForSelector") return "locator.waitFor";
  if (method === "expect") {
    // convert dot-separated expression like "to.be.visible" to camelCase "toBeVisible"
    const expr = entry.params?.expression || "";
    const camel = expr.replace(/\.(.)/g, (_, c) => c.toUpperCase());
    return `expect.${camel}`;
  }
  if (method === "keyboardPress") return "keyboard.press";
  if (method === "keyboardType") return "keyboard.type";
  if (method === "keyboardInsertText") return "keyboard.insertText";
  if (method === "click") return `${cls.toLowerCase()}.click`;
  if (method === "fill") return `${cls.toLowerCase()}.fill`;
  if (method === "textContent") return `${cls.toLowerCase()}.textContent`;
  if (method === "innerText") return `${cls.toLowerCase()}.innerText`;
  if (method === "evaluate") return `${cls.toLowerCase()}.evaluate`;
  if (method === "evaluateHandle") return `${cls.toLowerCase()}.evaluateHandle`;
  if (method === "selectOption") return `${cls.toLowerCase()}.selectOption`;

  if (cls && method) return `${cls.toLowerCase()}.${method}`;
  if (method) return method;
  return "unknown";
}

/** Extract the most informative selector or key from the entry params. */
function selectorLabel(entry) {
  const p = entry.params || {};
  if (p.selector) return p.selector;
  if (p.key) return p.key;
  if (p.text) return JSON.stringify(p.text).slice(0, 60);
  return "";
}

async function main() {
  const input = process.argv[2];
  if (!input) usage();

  const { tracePath, tmpDir } = resolveTracePath(input);

  try {
    // first pass: collect all before/after entries keyed by callId
    const befores = new Map();
    const afters = new Map();

    const rl = readline.createInterface({
      input: fs.createReadStream(tracePath),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === "before" && obj.callId) {
          befores.set(obj.callId, obj);
        } else if (obj.type === "after" && obj.callId) {
          afters.set(obj.callId, obj);
        }
      } catch {
        // skip malformed lines (trace files may contain non-NDJSON metadata)
      }
    }

    if (befores.size === 0) {
      console.error("Warning: no trace actions found. Is this a valid Playwright trace file?");
    }

    // correlate before/after pairs and output in order
    const callIds = [...befores.keys()];
    const pad = (s, n) => s.slice(0, n).padEnd(n);

    for (let i = 0; i < callIds.length; i++) {
      const id = callIds[i];
      const before = befores.get(id);
      const after = afters.get(id);

      const status = after?.error ? "error" : after ? "ok" : "incomplete";
      const api = apiLabel(before);
      const sel = selectorLabel(before);
      const err = after?.error?.message || "";

      const idx = String(i).padStart(3);
      const statusStr = pad(status, 10);
      const apiStr = pad(api, 28);
      const selStr = pad(`sel=${sel}`, 50);
      const errStr = err ? `err=${err}` : "";

      console.log(`${idx} ${statusStr}| ${apiStr}| ${selStr}| ${errStr}`);
    }

    // summary
    const total = callIds.length;
    const errors = callIds.filter((id) => afters.get(id)?.error).length;
    const incomplete = callIds.filter((id) => !afters.has(id)).length;
    const counts = [`${errors} error(s)`, incomplete > 0 && `${incomplete} incomplete`]
      .filter(Boolean)
      .join(", ");
    console.log(`\n${total} actions, ${counts}`);
  } finally {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
