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

  it('el lanzador reinicia el agente si se cae (el Programador solo reintenta si no arranca)', () => {
    const script = leer('agente-windows.ps1')
    expect(script).toContain('while ($true)')
    expect(script).toContain('if ($LASTEXITCODE -eq 0)')
    expect(script).toContain('Start-Sleep -Seconds 10')
  })

  it('la tarea programada no caduca y se reinicia si falla', () => {
    const script = leer('instalar-agente-windows.ps1')

    expect(script).toContain("Register-ScheduledTask -TaskName 'centro-agentes agente'")
    // Con dominio: vale para cuentas locales, de Microsoft y de dominio.
    expect(script).toContain('New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\\$env:USERNAME"')
    // conhost --headless: con Windows Terminal como consola por defecto,
    // -WindowStyle Hidden no oculta la ventana (y cerrarla mataría el agente).
    expect(script).toContain("-Execute 'conhost.exe'")
    expect(script).toContain('--headless powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File')
    expect(script).toContain('-Priority 4')
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
