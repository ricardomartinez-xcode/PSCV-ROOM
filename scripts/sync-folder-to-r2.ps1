# PSCV-ROOM: one-way, non-destructive upload from a Windows/OneDrive folder to Cloudflare R2.
# Prerequisites: rclone installed, an S3 remote configured with Cloudflare R2 Object Read/Write.
# The default is a DRY RUN. Add -Apply only after reviewing the output.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$SourceFolder,
  [string]$RemoteName = "pscv-r2",
  [string]$Bucket = "psicologia",
  [string]$TargetFolder = "Sincronizado-PC",
  [switch]$Apply
)
$ErrorActionPreference = "Stop"
if (-not (Get-Command rclone -ErrorAction SilentlyContinue)) {
  throw "rclone no está instalado. Consulta https://rclone.org/install/"
}
$source = (Resolve-Path -LiteralPath $SourceFolder -ErrorAction Stop).Path
if (-not (Test-Path -LiteralPath $source -PathType Container)) {
  throw "La ruta de origen no es una carpeta."
}
if ($RemoteName -notmatch '^[a-zA-Z0-9_-]+$' -or $Bucket -notmatch '^[a-zA-Z0-9_-]+$' -or
    $TargetFolder -notmatch '^[a-zA-Z0-9_ -]+$') {
  throw "Remote, bucket o subcarpeta inválidos."
}
$remotes = @(rclone listremotes)
if ($LASTEXITCODE -ne 0 -or -not ($remotes -contains ($RemoteName + ":"))) {
  throw "Falta configurar $RemoteName con 'rclone config' y credenciales R2 de solo este bucket."
}
$destination = "$($RemoteName):$Bucket/$TargetFolder"
Write-Host "Origen: $source"
Write-Host "Destino R2: $destination"
Write-Host "Política: copiar nuevos/modificados, NO borrar archivos remotos."
$argsList = @("copy", $source, $destination, "--fast-list", "--checkers", "4",
  "--transfers", "2", "--log-level", "INFO",
  "--exclude", "*.tmp", "--exclude", "*.part", "--exclude", "~$*",
  "--exclude", ".DS_Store", "--exclude", "Thumbs.db")
if (-not $Apply) {
  Write-Host "Simulación: no se escribirán archivos. Usa -Apply tras validar."
  $argsList += "--dry-run"
}
& rclone @argsList
if ($LASTEXITCODE -ne 0) { throw "Error de sincronización rclone: código $LASTEXITCODE" }
Write-Host "Ejecución completada."
