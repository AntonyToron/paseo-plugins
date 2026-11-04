export type TreeRow<File extends { path: string }> =
  | { kind: "dir"; path: string; name: string; depth: number; fileCount: number; open: boolean }
  | { kind: "file"; file: File; depth: number };

interface Dir<File> {
  dirs: Map<string, Dir<File>>;
  files: File[];
}

const fileCount = <File>(dir: Dir<File>): number =>
  dir.files.length + [...dir.dirs.values()].reduce((sum, child) => sum + fileCount(child), 0);

/**
 * The files as a folder tree, GitHub style: folders first, then files, each alphabetical, and a
 * folder whose only child is another folder shown as one row ("src/start/server").
 */
export function folderRows<File extends { path: string }>(
  files: readonly File[],
  closed: ReadonlySet<string>,
): TreeRow<File>[] {
  const root: Dir<File> = { dirs: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      let child = dir.dirs.get(part);
      if (!child) {
        child = { dirs: new Map(), files: [] };
        dir.dirs.set(part, child);
      }
      dir = child;
    }
    dir.files.push(file);
  }

  const rows: TreeRow<File>[] = [];
  const walk = (dir: Dir<File>, prefix: string, depth: number) => {
    for (const [part, start] of [...dir.dirs].sort(([a], [b]) => a.localeCompare(b))) {
      let name = part;
      let child = start;
      while (child.files.length === 0 && child.dirs.size === 1) {
        const [[next, only]] = child.dirs;
        name = `${name}/${next}`;
        child = only;
      }
      const path = prefix ? `${prefix}/${name}` : name;
      const open = !closed.has(path);
      rows.push({ kind: "dir", path, name, depth, fileCount: fileCount(child), open });
      if (open) walk(child, path, depth + 1);
    }
    const sorted = [...dir.files].sort((a, b) => a.path.localeCompare(b.path));
    for (const file of sorted) rows.push({ kind: "file", file, depth });
  };
  walk(root, "", 0);
  return rows;
}
