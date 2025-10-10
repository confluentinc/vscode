import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { Uri } from "vscode";
import yazl from "yazl";
import { inspectJarClasses, listJarContents } from "./jarInspector";

async function createTempJar(entries: Record<string, string>): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarInspectorTest-"));
  const jarPath = path.join(tmpDir, "test.jar");
  const zipFile = new yazl.ZipFile();
  const writeStream = fs.createWriteStream(jarPath);
  zipFile.outputStream.pipe(writeStream);
  for (const [name, content] of Object.entries(entries)) {
    zipFile.addBuffer(Buffer.from(content), name);
  }
  zipFile.end();
  return new Promise<string>((resolve, reject) => {
    writeStream.on("close", () => resolve(jarPath));
    writeStream.on("error", reject);
  });
}

describe("utils/jarInspector", () => {
  it("extracts class names ignoring inner classes and META-INF", async () => {
    const jarPath = await createTempJar({
      "com/example/MyClass.class": "binary",
      "com/example/Inner$Class.class": "binary",
      "META-INF/MANIFEST.MF": "manifest",
    });
    const classes = await inspectJarClasses(Uri.file(jarPath));
    assert.strictEqual(classes.length, 1);
    assert.strictEqual(classes[0].className, "com.example.MyClass");
  });

  it("returns empty list for jar with no classes", async () => {
    const jarPath = await createTempJar({ "README.txt": "hello" });
    const classes = await inspectJarClasses(Uri.file(jarPath));
    assert.strictEqual(classes.length, 0);
  });

  it("throws an error for a corrupted JAR", async () => {
    // Create a valid JAR then corrupt it by truncating bytes
    const jarPath = await createTempJar({ "com/example/MyClass.class": "binary" });
    const original = fs.readFileSync(jarPath);
    // Keep only first 10 bytes – invalid central directory
    fs.writeFileSync(jarPath, original.subarray(0, 10));
    await assert.rejects(async () => await inspectJarClasses(Uri.file(jarPath)), {
      message: /Unable to inspect JAR file/i,
    });
  });

  it("throws for non .jar extension", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarInspectorTest-"));
    const fakePath = path.join(tmpDir, "notAJar.txt");
    fs.writeFileSync(fakePath, "data");
    await assert.rejects(async () => await listJarContents(fakePath), {
      message: /does not have \.jar extension/i,
    });
  });

  it("throws when file is unreadable or missing", async () => {
    const missing = path.join(os.tmpdir(), "jarInspectorTest-missing", "missing.jar");
    await assert.rejects(async () => await listJarContents(missing), {
      message: /JAR file not readable/i,
    });
  });

  it("throws for non .jar extension", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "jarInspectorTest-"));
    const fakePath = path.join(tmpDir, "notAJar.txt");
    fs.writeFileSync(fakePath, "data");
    let threw = false;
    try {
      await listJarContents(fakePath);
    } catch (e) {
      threw = true;
      assert.match((e as Error).message, /does not have \.jar extension/i);
    }
    assert.ok(threw);
  });

  it("throws when file is unreadable or missing", async () => {
    const missing = path.join(os.tmpdir(), "jarInspectorTest-missing", "missing.jar");
    let threw = false;
    try {
      await listJarContents(missing);
    } catch (e) {
      threw = true;
      assert.match((e as Error).message, /JAR file not readable/i);
    }
    assert.ok(threw);
  });
});
