import { describe, expect, it } from "vitest";
import { sectionPath } from "../server/review-mirror";
import { excerpt, settleSort } from "../server/review-sort";
import { fileGroup, parseDiff } from "../shared/review";

describe("sectionPath", () => {
  it("names a section by its new path, or the old one for a deletion", () => {
    expect(
      sectionPath(
        "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n",
      ),
    ).toBe("src/a.ts");
    expect(
      sectionPath(
        "diff --git a/old.ts b/new.ts\nsimilarity index 100%\nrename from old.ts\nrename to new.ts\n",
      ),
    ).toBe("new.ts");
    expect(
      sectionPath(
        "diff --git a/gone.ts b/gone.ts\ndeleted file mode 100644\n--- a/gone.ts\n+++ /dev/null\n",
      ),
    ).toBe("gone.ts");
    expect(
      sectionPath("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n"),
    ).toBe("x.png");
  });
});

describe("fileGroup", () => {
  it("sorts files by path alone", () => {
    expect(fileGroup("src/start/server.ts")).toBe("source");
    expect(fileGroup("src/sync/sdkNames.test.ts")).toBe("tests");
    expect(fileGroup("tests/start/harness.mjs")).toBe("tests");
    expect(fileGroup("src/__tests__/util.ts")).toBe("tests");
    expect(fileGroup("package-lock.json")).toBe("generated");
    expect(fileGroup("apps/web/yarn.lock")).toBe("generated");
    expect(fileGroup("src/__snapshots__/view.test.ts.snap")).toBe("generated");
    expect(fileGroup("packages/sdk/dist/index.js")).toBe("generated");
    expect(fileGroup("package.json")).toBe("config");
    expect(fileGroup("tsconfig.build.json")).toBe("config");
    expect(fileGroup("vite.config.ts")).toBe("config");
    expect(fileGroup("docs/start.md")).toBe("config");
  });
});

describe("parseDiff", () => {
  it("numbers old and new lines through a hunk and drops the file header", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,3 @@ export function a() {",
      " keep",
      "-old",
      "+new",
      " tail",
      "",
    ].join("\n");
    expect(parseDiff(diff)).toEqual([
      {
        kind: "hunk",
        text: "@@ -10,3 +10,3 @@ export function a() {",
        oldLine: null,
        newLine: null,
      },
      { kind: "context", text: "keep", oldLine: 10, newLine: 10 },
      { kind: "remove", text: "old", oldLine: 11, newLine: null },
      { kind: "add", text: "new", oldLine: null, newLine: 11 },
      { kind: "context", text: "tail", oldLine: 12, newLine: 12 },
    ]);
  });

  it("says when a binary file changed", () => {
    expect(
      parseDiff("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n"),
    ).toEqual([{ kind: "meta", text: "Binary file changed", oldLine: null, newLine: null }]);
  });
});

describe("settleSort", () => {
  const file = (path: string) => ({
    path,
    additions: 1,
    deletions: 0,
    changeType: "MODIFIED",
    viewed: "UNVIEWED" as const,
    group: "source" as const,
  });

  it("keeps Claude's order within a tier, drops invented paths and places forgotten ones", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts"].map(file);
    const settled = settleSort(files, [
      { path: "c.ts", tier: "trivial", summary: "rename" },
      { path: "b.ts", tier: "core", summary: "the logic" },
      { path: "made-up.ts", tier: "core", summary: "" },
      { path: "a.ts", tier: "core", summary: "entry point" },
      { path: "b.ts", tier: "trivial", summary: "duplicate" },
    ]);
    expect(settled.map((entry) => [entry.path, entry.tier])).toEqual([
      ["b.ts", "core"],
      ["a.ts", "core"],
      ["d.ts", "supporting"],
      ["c.ts", "trivial"],
    ]);
  });
});

describe("excerpt", () => {
  it("keeps hunk headers and changed lines, not context", () => {
    const diff = "--- a/x.ts\n+++ b/x.ts\n@@ -1,3 +1,3 @@\n same\n-old\n+new\n same\n";
    expect(excerpt(diff)).toBe("@@ -1,3 +1,3 @@\n-old\n+new");
  });
});
