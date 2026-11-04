import { describe, expect, it } from "vitest";
import { decorateFile, languageFor, mergeSegments } from "../client/decorate";
import { parseDiff } from "../shared/review";

describe("languageFor", () => {
  it("knows common source files and leaves the rest plain", () => {
    expect(languageFor("src/start/index.ts")).toBe("typescript");
    expect(languageFor("app/page.tsx")).toBe("tsx");
    expect(languageFor("Dockerfile")).toBe("docker");
    expect(languageFor("yarn.lock")).toBeNull();
  });
});

describe("mergeSegments", () => {
  it("cuts tokens where a changed range starts and ends", () => {
    expect(
      mergeSegments(
        [
          { text: "const", type: "keyword" },
          { text: " ab", type: null },
        ],
        [[3, 7]],
      ),
    ).toEqual([
      { text: "con", type: "keyword", changed: false },
      { text: "st", type: "keyword", changed: true },
      { text: " a", type: null, changed: true },
      { text: "b", type: null, changed: false },
    ]);
  });
});

describe("decorateFile", () => {
  const lines = parseDiff(
    [
      "@@ -1,4 +1,4 @@",
      " /** A comment",
      "  * that spans lines */",
      "-const relativePath = path.relative(cwd, id);",
      "+const relativePath = path.relative(cwd, file);",
    ].join("\n"),
  );

  it("colours a comment that spans lines and marks the edited word", () => {
    const decorated = decorateFile(lines, "src/vite.ts");
    expect(decorated[0]).toBeNull();
    expect(decorated[2]?.every((segment) => segment.type === "comment")).toBe(true);
    const changed = (index: number) =>
      decorated[index]
        ?.filter((segment) => segment.changed)
        .map((segment) => segment.text)
        .join("");
    expect(changed(3)).toBe("id");
    expect(changed(4)).toBe("file");
    expect(decorated[4]?.map((segment) => segment.text).join("")).toBe(lines[4]?.text);
  });
});
