// All user-visible text (Italian).
export const strings = {
  appName: 'Raccoglitore',
  underConstruction: 'In preparazione',
  version: (version: string) => `Versione ${version}`,
  unsupportedSchema: 'Questa carta è stata esportata con una versione più recente: aggiorna l’app.',
} as const;

// Text shown only by development tools; kept separate so production builds drop it.
export const devStrings = {
  cardsLoading: 'Sorgente locale: lettura…',
  cardsFound: (count: number) => (count === 1 ? 'Sorgente locale: 1 carta' : `Sorgente locale: ${count} carte`),
  cardsError: 'Sorgente locale non raggiungibile',
  unknownPage: (page: string) => `Pagina di sviluppo sconosciuta: ${page}`,
  renderLoading: 'Caricamento…',
  renderCardMissing: (id: string) => `Carta "${id}" non trovata in index.json`,
  renderContextLost: 'Contesto GPU perso: ripristino…',
  renderHalfEnough: (tilt: boolean, immersive: boolean) =>
    `half basta: inclinazione ${tilt ? 'sì' : 'no'}, immersiva ${immersive ? 'sì' : 'no'}`,
  renderFrame: (sourceFrame: number) => `f ${sourceFrame}`,
  renderLevels: 'livelli',
  renderHoldReference: 'Tieni premuto: riferimento',
  renderReferenceBadge: 'RIFERIMENTO',
  renderReferenceLoading: 'Riferimento in caricamento…',
  renderTapToHide: 'Tocca l’immagine: nascondi/mostra i comandi · tieni premuto: fotogramma di riferimento',
  premultiplyTitle: 'Verifica alpha premoltiplicato',
  premultiplyOk: (texels: number) => `OK: ${texels} texel su ${texels} esatti`,
  premultiplyFail: (bad: number, texels: number, maxError: number) =>
    `ERRORE: ${bad} texel su ${texels} diversi (errore massimo ${maxError})`,
  premultiplyExpected: 'atteso',
  premultiplyGot: 'letto',
} as const;
