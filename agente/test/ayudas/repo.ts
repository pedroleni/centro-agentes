import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function ejecutarGit(cwd: string, argumentos: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', argumentos, {
    cwd,
    timeout: 5_000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    encoding: 'utf8',
  })
  return stdout
}

export async function crearRepo(
  dir: string,
  commits: { mensaje: string; fechaMs: number }[],
): Promise<void> {
  await mkdir(dir, { recursive: true })
  await ejecutarGit(dir, ['init', '-b', 'main'])
  await ejecutarGit(dir, ['config', 'user.name', 'Pruebas Centro'])
  await ejecutarGit(dir, ['config', 'user.email', 'pruebas@centro.invalid'])

  for (const [indice, commit] of commits.entries()) {
    await writeFile(path.join(dir, `commit-${indice}.txt`), `${commit.mensaje}\n`)
    await ejecutarGit(dir, ['add', `commit-${indice}.txt`])
    const fecha = new Date(commit.fechaMs).toISOString()
    await execFileAsync('git', ['commit', '-m', commit.mensaje], {
      cwd: dir,
      timeout: 5_000,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: '0',
        GIT_AUTHOR_DATE: fecha,
        GIT_COMMITTER_DATE: fecha,
      },
      encoding: 'utf8',
    })
  }
}
