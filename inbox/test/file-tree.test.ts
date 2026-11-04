import { describe, expect, it } from "vitest";
import { folderRows } from "../shared/file-tree";

const files = ["src/start/server/a.ts", "src/start/server/b.ts", "src/start/c.ts", "README.md"].map(
  (path) => ({ path }),
);
const describeRow = (row: ReturnType<typeof folderRows<{ path: string }>>[number]) =>
  row.kind === "dir"
    ? `${"  ".repeat(row.depth)}${row.name}/ (${row.fileCount})`
    : `${"  ".repeat(row.depth)}${row.file.path.split("/").at(-1)}`;

describe("folderRows", () => {
  it("lists folders before files and joins single-folder chains", () => {
    expect(folderRows(files, new Set()).map(describeRow)).toEqual([
      "src/start/ (3)",
      "  server/ (2)",
      "    a.ts",
      "    b.ts",
      "  c.ts",
      "README.md",
    ]);
  });

  it("hides what's inside a closed folder", () => {
    expect(folderRows(files, new Set(["src/start/server"])).map(describeRow)).toEqual([
      "src/start/ (3)",
      "  server/ (2)",
      "  c.ts",
      "README.md",
    ]);
  });
});
