import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function leer(nombre: string): string {
  return readFileSync(path.join(raiz, 'scripts', 'servicios', nombre), 'utf8')
}

describe('servicios de Windows', () => {
  it('el lanzador parte de la raíz, guarda el registro y devuelve el código de salida', () => {
    const script = leer('agente-windows.ps1')

    expect(script).toContain("Join-Path $PSScriptRoot '..\\..'")
    expect(script).toContain('$env:LOCALAPPDATA')
    expect(script).toContain('New-Item')
    // Con cmd y no con *>>: PowerShell 5.1 escribiría el registro en UTF-16 y
    // envolvería cada línea de error de npm como NativeCommandError.
    expect(script).toContain('cmd.exe /d /c')
    expect(script).toContain('npm run agente:conectar >>')
    expect(script).toContain('2>&1')
    expect(script).not.toContain('*>>')
    expect(script).toContain('agente.log')
    expect(script).toContain('exit $LASTEXITCODE')
  })

  it('la tarea programada no caduca y se reinicia si falla', () => {
    const script = leer('instalar-agente-windows.ps1')

    expect(script).toContain("Register-ScheduledTask -TaskName 'centro-agentes agente'")
    // Con dominio: vale para cuentas locales, de Microsoft y de dominio.
    expect(script).toContain('New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"')
    expect(script).toContain('powershell.exe')
    expect(script).toContain('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File')
    expect(script).toContain('agente-windows.ps1')
    expect(script).toContain('-ExecutionTimeLimit ([TimeSpan]::Zero)')
    expect(script).toContain('-RestartCount 999')
    expect(script).toContain('-RestartInterval (New-TimeSpan -Minutes 1)')
    expect(script).toContain('-MultipleInstances IgnoreNew')
    expect(script).toContain('-StartWhenAvailable')
    expect(script).toContain('-AllowStartIfOnBatteries')
    expect(script).toContain('-DontStopIfGoingOnBatteries')
    expect(script).toContain("Unregister-ScheduledTask -TaskName 'centro-agentes agente' -Confirm:$false")
  })
})
