import { Commit, Instantanea } from '@centro/compartido'

async function obtenerJson(respuesta: Response): Promise<unknown> {
  if (!respuesta.ok) {
    throw new Error(`La API respondió con ${respuesta.status}`)
  }
  return respuesta.json()
}

export async function obtenerInstantanea(): Promise<Instantanea> {
  const respuesta = await fetch('/api/instantanea')
  return Instantanea.parse(await obtenerJson(respuesta))
}

export async function obtenerCommits(id: string): Promise<Commit[]> {
  const respuesta = await fetch(`/api/proyectos/${encodeURIComponent(id)}/commits`)
  const cuerpo = await obtenerJson(respuesta)
  return Commit.array().parse(
    typeof cuerpo === 'object' && cuerpo !== null && 'commits' in cuerpo
      ? cuerpo.commits
      : cuerpo,
  )
}
