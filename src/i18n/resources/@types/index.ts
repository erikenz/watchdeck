export type LanguageResources = Record<
  string,
  {
    translation: Record<string, unknown> & {
      language?: {
        name: string;
        "local-name": string;
        code: string;
      };
    };
  }
>;
