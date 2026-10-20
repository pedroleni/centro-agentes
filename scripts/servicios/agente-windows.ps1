# Arranca el agente desde la raíz del repositorio y conserva su salida para diagnóstico.
# Lo lanza la tarea programada "centro-agentes agente" al iniciar sesión.
$RaizRepositorio = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $RaizRepositorio

# LOCALAPPDATA pertenece al usuario que ha iniciado sesión y no requiere privilegios.
$Carpeta = Join-Path $env:LOCALAPPDATA 'centro-agentes'
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$Registro = Join-Path $Carpeta 'agente.log'

# El Programador de tareas solo reintenta si la tarea no llega a arrancar, no si
# el agente se cae después: por eso el bucle está aquí, como el KeepAlive de
# launchd. Con 0 (token revocado u otra copia conectada) se para; con error, se
# vuelve a lanzar con una espera creciente (10 s → 5 min), que vuelve a 10 s si
# el agente aguantó más de un minuto.
$Espera = 10
while ($true) {
    $Inicio = Get-Date
    # Se redirige con cmd y no con PowerShell: PowerShell 5.1 escribiría el
    # registro en UTF-16 y envolvería cada línea de error de npm como NativeCommandError.
    cmd.exe /d /c "npm run agente:conectar >> `"$Registro`" 2>&1"
    if ($LASTEXITCODE -eq 0) { exit $LASTEXITCODE }
    if (((Get-Date) - $Inicio).TotalSeconds -gt 60) { $Espera = 10 }
    Start-Sleep -Seconds $Espera
    $Espera = [Math]::Min($Espera * 2, 300)
}
