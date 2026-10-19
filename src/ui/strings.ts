// All user-visible text (Italian).
export const strings = {
  appName: 'Raccoglitore',
  underConstruction: 'In preparazione',
  version: (version: string) => `Versione ${version}`,
} as const;

// Text shown only by development tools; kept separate so production builds drop it.
export const devStrings = {
  cardsLoading: 'Sorgente locale: lettura…',
  cardsFound: (count: number) => (count === 1 ? 'Sorgente locale: 1 carta' : `Sorgente locale: ${count} carte`),
  cardsError: 'Sorgente locale non raggiungibile',
} as const;
