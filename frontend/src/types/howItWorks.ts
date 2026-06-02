export interface TechnicalContent {
  equations?: string[];        // LaTeX strings for BlockMath rendering
  pseudocode?: string;         // Raw string for <pre> monospace block
  tables?: {
    headers: string[];
    rows: string[][];
  }[];
  prose?: string;              // Optional supplementary technical prose
}

export interface SectionDefinition {
  id: string;                  // kebab-case slug used as the anchor id (e.g. "era-normalization")
  title: string;
  plainEnglish: string;        // Plain-English prose (supports JSX string or markdown-safe HTML)
  technical: TechnicalContent;
}
