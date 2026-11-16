export const avatarOptions: ReadonlyArray<{
  seed: string
  label: string
  palette: number
  pattern: number
}>
export const defaultAvatarSeed: string
export function avatarDataUri(seed: string): string
export function avatarSvg(seed: string): string
