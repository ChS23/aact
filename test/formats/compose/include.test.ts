import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveIncludes } from "../../../src/formats/compose/include";

const makeDir = () => mkdtemp(join(tmpdir(), "aact-compose-include-"));

describe("resolveIncludes — simple cases", () => {
  it("loads a standalone compose file (no includes)", async () => {
    const dir = await makeDir();
    const file = join(dir, "compose.yml");
    await writeFile(file, "services:\n  api:\n    image: nginx\n", "utf8");
    const result = await resolveIncludes(file);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe(file);
    expect(result.files[0].parsed.services?.api).toEqual({ image: "nginx" });
    expect(result.issues).toEqual([]);
  });

  it("returns documentFactory that produces a parsed Document", async () => {
    const dir = await makeDir();
    const file = join(dir, "compose.yml");
    await writeFile(file, "services:\n  api:\n    image: nginx\n", "utf8");
    const result = await resolveIncludes(file);
    const doc = result.files[0].documentFactory();
    expect(doc.contents).toBeDefined();
  });

  it("source field equals the original file contents", async () => {
    const dir = await makeDir();
    const file = join(dir, "compose.yml");
    const src = "name: demo\nservices:\n  api:\n    image: x\n";
    await writeFile(file, src, "utf8");
    const result = await resolveIncludes(file);
    expect(result.files[0].source).toBe(src);
  });
});

describe("resolveIncludes — include chain", () => {
  it("returns included files in DFS post-order (entry last)", async () => {
    const dir = await makeDir();
    const childPath = join(dir, "child.yml");
    const entryPath = join(dir, "compose.yml");
    await writeFile(
      childPath,
      "services:\n  db:\n    image: postgres\n",
      "utf8",
    );
    await writeFile(
      entryPath,
      "include:\n  - ./child.yml\nservices:\n  api:\n    image: nginx\n",
      "utf8",
    );
    const result = await resolveIncludes(entryPath);
    expect(result.files.map((f) => f.file)).toEqual([childPath, entryPath]);
    expect(result.issues).toEqual([]);
  });

  it("accepts long-form include entries (object with `path`)", async () => {
    const dir = await makeDir();
    const childPath = join(dir, "child.yml");
    const entryPath = join(dir, "compose.yml");
    await writeFile(
      childPath,
      "services:\n  db:\n    image: postgres\n",
      "utf8",
    );
    await writeFile(
      entryPath,
      "include:\n  - path: ./child.yml\nservices:\n  api:\n    image: nginx\n",
      "utf8",
    );
    const result = await resolveIncludes(entryPath);
    expect(result.files).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });

  it("multi-path long-form include picks first path", async () => {
    const dir = await makeDir();
    const child1 = join(dir, "child1.yml");
    const child2 = join(dir, "child2.yml");
    const entry = join(dir, "compose.yml");
    await writeFile(child1, "services:\n  c1:\n    image: x\n", "utf8");
    await writeFile(child2, "services:\n  c2:\n    image: y\n", "utf8");
    await writeFile(
      entry,
      `include:\n  - path:\n      - ./child1.yml\n      - ./child2.yml\nservices:\n  api:\n    image: nginx\n`,
      "utf8",
    );
    const result = await resolveIncludes(entry);
    // Only the first include path is loaded — child2 stays absent.
    expect(result.files.map((f) => f.file)).toEqual([child1, entry]);
  });
});

describe("resolveIncludes — error paths", () => {
  it("hard-throws when entry file is missing", async () => {
    const dir = await makeDir();
    const missing = join(dir, "does-not-exist.yml");
    await expect(resolveIncludes(missing)).rejects.toThrow();
  });

  it("missing included file → loader-warning, not throw", async () => {
    const dir = await makeDir();
    const entry = join(dir, "compose.yml");
    await writeFile(
      entry,
      "include:\n  - ./missing.yml\nservices:\n  api:\n    image: nginx\n",
      "utf8",
    );
    const result = await resolveIncludes(entry);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatchObject({
      kind: "loader-warning",
      source: "compose",
      code: "include-read-error",
    });
    // Entry still loaded.
    expect(result.files.map((f) => f.file)).toEqual([entry]);
  });

  it("malformed include entry (no path field) → loader-warning", async () => {
    const dir = await makeDir();
    const entry = join(dir, "compose.yml");
    await writeFile(
      entry,
      "include:\n  - { foo: bar }\nservices:\n  api:\n    image: nginx\n",
      "utf8",
    );
    const result = await resolveIncludes(entry);
    expect(
      result.issues.some((i) => "code" in i && i.code === "include-malformed"),
    ).toBe(true);
  });

  it("cycle detection: A → B → A → loader-warning, no infinite recursion", async () => {
    const dir = await makeDir();
    const a = join(dir, "a.yml");
    const b = join(dir, "b.yml");
    await writeFile(
      a,
      "include:\n  - ./b.yml\nservices:\n  ax:\n    image: x\n",
      "utf8",
    );
    await writeFile(
      b,
      "include:\n  - ./a.yml\nservices:\n  bx:\n    image: y\n",
      "utf8",
    );
    const result = await resolveIncludes(a);
    expect(
      result.issues.some((i) => "code" in i && i.code === "include-cycle"),
    ).toBe(true);
  });

  it("duplicate include (diamond) is loaded only once", async () => {
    const dir = await makeDir();
    const shared = join(dir, "shared.yml");
    const left = join(dir, "left.yml");
    const right = join(dir, "right.yml");
    const entry = join(dir, "compose.yml");
    await writeFile(shared, "services:\n  s:\n    image: x\n", "utf8");
    await writeFile(
      left,
      "include:\n  - ./shared.yml\nservices:\n  l:\n    image: x\n",
      "utf8",
    );
    await writeFile(
      right,
      "include:\n  - ./shared.yml\nservices:\n  r:\n    image: x\n",
      "utf8",
    );
    await writeFile(
      entry,
      "include:\n  - ./left.yml\n  - ./right.yml\nservices:\n  api:\n    image: nginx\n",
      "utf8",
    );
    const result = await resolveIncludes(entry);
    // `shared` should appear exactly once.
    const sharedCount = result.files.filter((f) => f.file === shared).length;
    expect(sharedCount).toBe(1);
  });
});
