export const searchScanLimit = 1000
export const searchResultLimit = 30
export const foldText = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('de-DE')
