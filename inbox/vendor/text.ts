// Entry for client/vendor/text.js, built by `npm run vendor`. Plugins installed from git get no
// npm install, so the libraries the review screen uses are bundled into the repo instead.
import { diffWordsWithSpace } from "diff";
import type { Element, ElementContent, Root } from "hast";
import { refractor } from "refractor/core";
import bash from "refractor/bash";
import css from "refractor/css";
import docker from "refractor/docker";
import go from "refractor/go";
import graphql from "refractor/graphql";
import javascript from "refractor/javascript";
import json from "refractor/json";
import jsx from "refractor/jsx";
import markdown from "refractor/markdown";
import markup from "refractor/markup";
import python from "refractor/python";
import rust from "refractor/rust";
import scss from "refractor/scss";
import sql from "refractor/sql";
import toml from "refractor/toml";
import tsx from "refractor/tsx";
import typescript from "refractor/typescript";
import yaml from "refractor/yaml";

for (const language of [
  markup,
  css,
  javascript,
  typescript,
  jsx,
  tsx,
  json,
  bash,
  docker,
  go,
  graphql,
  markdown,
  python,
  rust,
  scss,
  sql,
  toml,
  yaml,
])
  refractor.register(language);

export interface Token {
  text: string;
  /** Prism's token type, innermost first, e.g. "keyword" or "string"; null for plain text. */
  type: string | null;
}

const tokenType = (classes: readonly string[]): string | null =>
  classes.filter((name) => name !== "token").at(0) ?? null;

/** The code's tokens, line by line. Whole blocks keep comments and strings that span lines intact. */
export function highlightLines(code: string, language: string): Token[][] {
  const lines: Token[][] = [[]];
  const push = (text: string, type: string | null) => {
    text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines.at(-1)!.push({ text: part, type });
    });
  };
  const walk = (nodes: readonly ElementContent[], type: string | null) => {
    for (const node of nodes) {
      if (node.type === "text") push(node.value, type);
      else if (node.type === "element") {
        const classes = ((node as Element).properties.className ?? []) as string[];
        walk(node.children, tokenType(classes) ?? type);
      }
    }
  };
  const root: Root = refractor.highlight(code, language);
  walk(root.children as ElementContent[], null);
  return lines;
}

export const highlightable = (language: string) => refractor.registered(language);

export interface WordChanges {
  /** Character ranges, [start, end), that only the old line has. */
  removed: [number, number][];
  /** Character ranges that only the new line has. */
  added: [number, number][];
  /** Share of the two lines' characters they have in common, 0 to 1. */
  similarity: number;
}

export function wordChanges(before: string, after: string): WordChanges {
  const removed: [number, number][] = [];
  const added: [number, number][] = [];
  let oldAt = 0;
  let newAt = 0;
  let common = 0;
  for (const part of diffWordsWithSpace(before, after)) {
    const length = part.value.length;
    if (part.removed) {
      removed.push([oldAt, oldAt + length]);
      oldAt += length;
    } else if (part.added) {
      added.push([newAt, newAt + length]);
      newAt += length;
    } else {
      common += length;
      oldAt += length;
      newAt += length;
    }
  }
  const total = before.length + after.length;
  return { removed, added, similarity: total ? (2 * common) / total : 1 };
}
