# Instala (o, con -Desinstalar, quita) la tarea programada que arranca el agente
# de centro-agentes cada vez que inicias sesión en Windows.
#   powershell -ExecutionPolicy Bypass -File scripts\servicios\instalar-agente-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\servicios\instalar-agente-windows.ps1 -Desinstalar
param(
    [switch]$Desinstalar
)

# Permite retirar la tarea sin abrir el Programador de tareas.
if ($Desinstalar) {
    Unregister-ScheduledTask -TaskName 'centro-agentes agente' -Confirm:$false
    return
}

$RutaAgente = (Resolve-Path (Join-Path $PSScriptRoot 'agente-windows.ps1')).Path

# El agente se inicia únicamente cuando entras en tu sesión de Windows (§5.4): no
# hay servicios que corran antes de iniciar sesión. Con dominio para que valga
# con cuentas locales, de Microsoft y de dominio.
$Disparador = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$Accion = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$RutaAgente`""

# Sin el límite de 72 horas que pone Windows por defecto (mataría el agente a
# los tres días) y con reintentos cada minuto si npm o el agente fallan.
$Ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName 'centro-agentes agente' -Trigger $Disparador -Action $Accion -Settings $Ajustes -Force
