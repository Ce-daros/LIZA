param(
    [string]$Watcom = "C:\WATCOM16"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:WATCOM = $Watcom
$env:INCLUDE = Join-Path $Watcom "h"
$env:PATH = "$(Join-Path $Watcom 'binnt64');$(Join-Path $Watcom 'binnt');$env:PATH"

Push-Location (Join-Path $root "dos")
try {
    & wmake
    if ($LASTEXITCODE -ne 0) { throw "Open Watcom build failed" }
} finally {
    Pop-Location
}

& python (Join-Path $root "tools\create_dos_floppy.py")
if ($LASTEXITCODE -ne 0) { throw "Floppy image build failed" }
