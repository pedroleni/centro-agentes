import type { MaquinaVista } from '@centro/compartido'
import { useState } from 'react'
import { crearCodigoAlta, revocarMaquina } from '../api.js'

type Propiedades = {
  maquinas: MaquinaVista[]
  ahora: number
  alCerrar(): void
}

// Panel del hub para dar de alta una máquina (código de un solo uso + comandos) y
// para revocar las que ya existen.
export function AnadirMaquina({ maquinas, ahora, alCerrar }: Propiedades) {
  const [codigo, establecerCodigo] = useState<{ codigo: string; caducaMs: number } | null>(null)
  const [error, establecerError] = useState<string | null>(null)

  async function generar(): Promise<void> {
    establecerError(null)
    try {
      establecerCodigo(await crearCodigoAlta())
    } catch {
      establecerError('No se pudo generar el código')
    }
  }

  async function revocar(maquina: MaquinaVista): Promise<void> {
    if (!window.confirm(`¿Revocar "${maquina.nombre}"? Dejará de poder conectarse hasta que la vuelvas a dar de alta.`)) return
    try {
      await revocarMaquina(maquina.id)
    } catch {
      establecerError(`No se pudo revocar ${maquina.nombre}`)
    }
  }

  const minutos = codigo === null ? 0 : Math.max(0, Math.floor((codigo.caducaMs - ahora) / 60_000))
  const comandos = codigo === null ? '' : [
    'git clone git@github.com:pedroleni/centro-agentes.git && cd centro-agentes && npm install',
    `npm run agente:alta -- --hub ${window.location.origin} --codigo ${codigo.codigo}`,
    'npm run agente:conectar',
  ].join('\n')

  return (
    <div className="am-fondo" role="dialog" aria-modal="true" aria-label="Añadir máquina">
      <div className="am-panel">
        <div className="am-cabecera">
          <h2>Añadir máquina</h2>
          <button type="button" className="am-cerrar" aria-label="Cerrar" onClick={alCerrar}>✕</button>
        </div>
        {codigo === null ? (
          <p>
            Genera un código de un solo uso (dura 10 minutos) y ejecuta en la otra máquina los comandos que aparecerán.{' '}
            <button type="button" className="cd-btn pri" onClick={() => void generar()}>Generar código</button>
          </p>
        ) : (
          <>
            <p className="am-codigo"><strong>{codigo.codigo}</strong> <span>caduca en {minutos} min</span></p>
            <p>En la máquina nueva, dentro de una terminal:</p>
            <pre className="am-comandos">{comandos}</pre>
          </>
        )}
        {error !== null && <p className="am-error" role="alert">{error}</p>}
        <h3>Máquinas dadas de alta</h3>
        <ul className="am-lista">
          {maquinas.map((maquina) => (
            <li key={maquina.id}>
              <span>{maquina.nombre}</span>
              <span className={maquina.conectada ? 'ma-estado on' : 'ma-estado'}>{maquina.conectada ? '● Conectada' : '○ Desconectada'}</span>
              <button type="button" className="cd-btn" aria-label={`Revocar ${maquina.nombre}`} onClick={() => void revocar(maquina)}>
                Revocar
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
