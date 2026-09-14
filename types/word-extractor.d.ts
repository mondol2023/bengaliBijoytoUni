/**
 * `word-extractor` ships no type declarations. This is a minimal ambient
 * module covering only the surface this project actually uses — see
 * https://www.npmjs.com/package/word-extractor for the full API.
 */
declare module "word-extractor" {
  interface ExtractedWordDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
    getHeaders(options?: { includeFooters?: boolean }): string;
  }

  export default class WordExtractor {
    extract(input: string | Buffer): Promise<ExtractedWordDocument>;
  }
}
