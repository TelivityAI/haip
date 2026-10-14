export interface WorldlineTokenizerResult {
  success: boolean;
  hostedTokenizationId?: string;
  error?: { message?: string };
}

export interface WorldlineTokenizer {
  initialize: () => Promise<void>;
  submitTokenization: () => Promise<WorldlineTokenizerResult>;
}

export interface WorldlineTokenizerConstructor {
  new (
    hostedTokenizationUrl: string,
    elementId: string,
    options: { hideCardholderName: boolean },
  ): WorldlineTokenizer;
}

declare global {
  interface Window {
    Tokenizer?: WorldlineTokenizerConstructor;
  }
}

/** Load the tokenizer script for the merchant environment. Card data stays in the iframe. */
export function loadWorldlineTokenizer(scriptUrl: string, sri: string | null): Promise<void> {
  if (window.Tokenizer) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = scriptUrl;
    script.async = true;
    script.crossOrigin = 'anonymous';
    if (sri) script.integrity = sri;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Card field failed to load'));
    document.head.appendChild(script);
  });
}
