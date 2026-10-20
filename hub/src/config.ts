export type ConfigHub = {
  puerto: number
  hostPublico: string | null
  propietarioTailscale: string | null
  exigirTailscale: boolean
  contrasena: { sal: string; hash: string }
}
