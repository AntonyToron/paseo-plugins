// Types for text.js, bundled from vendor/text.ts by `npm run vendor`.
export interface Token {
  text: string;
  type: string | null;
}
export interface WordChanges {
  removed: [number, number][];
  added: [number, number][];
  similarity: number;
}
export declare function highlightLines(code: string, language: string): Token[][];
export declare function highlightable(language: string): boolean;
export declare function wordChanges(before: string, after: string): WordChanges;
