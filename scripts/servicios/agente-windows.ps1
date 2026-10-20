# Arranca el agente desde la raíz del repositorio y conserva su salida para diagnóstico.
# Lo lanza la tarea programada "centro-agentes agente" al iniciar sesión.
$RaizRepositorio = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $RaizRepositorio

# LOCALAPPDATA pertenece al usuario que ha iniciado sesión y no requiere privilegios.
$Carpeta = Join-Path $env:LOCALAPPDATA 'centro-agentes'
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$Registro = Join-Path $Carpeta 'agente.log'

# Se redirige con cmd y no con PowerShell: PowerShell 5.1 escribiría el registro
# en UTF-16 y envolvería cada línea de error de npm como NativeCommandError.
cmd.exe /d /c "npm run agente:conectar >> `"$Registro`" 2>&1"

# El código de salida decide si el Programador de tareas lo reinicia: con error,
# sí; con 0 (token revocado u otra copia conectada), no.
exit $LASTEXITCODE
