param(
    [string]$Watcom = "C:\WATCOM16"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:WATCOM = $Watcom
$watcomInclude = Join-Path $Watcom "h"
$env:INCLUDE = if ($env:INCLUDE) { "$watcomInclude;$env:INCLUDE" } else { $watcomInclude }
$env:PATH = "$(Join-Path $Watcom 'binnt64');$(Join-Path $Watcom 'binnt');$env:PATH"

& node (Join-Path $root "tools\generate_protocol.mjs") --check
if ($LASTEXITCODE -ne 0) { throw "Generated protocol files are stale" }

Push-Location (Join-Path $root "dos")
try {
    if (-not (Get-Command wmake -ErrorAction SilentlyContinue)) { throw "wmake not found; check the Open Watcom path (-Watcom $Watcom)" }
    & wmake
    if ($LASTEXITCODE -ne 0) { throw "Open Watcom build failed" }
} finally {
    Pop-Location
}

& python (Join-Path $root "tools\create_dos_floppy.py")
if ($LASTEXITCODE -ne 0) { throw "Floppy image build failed" }
