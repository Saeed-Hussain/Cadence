# Builds PROPOSAL.pdf from PROPOSAL.md and the generated SVG diagrams.
#
#   powershell -ExecutionPolicy Bypass -File docs\build.ps1
#
# Requires: Node (for npx marked), Python, and Chrome or Edge.

$ErrorActionPreference = 'Stop'
$docs = $PSScriptRoot
Push-Location $docs

Write-Host 'Generating diagrams...'
python (Join-Path $docs 'build-diagrams.py')

Write-Host 'Rendering markdown...'
npx --yes marked -i (Join-Path $docs 'PROPOSAL.md') -o (Join-Path $docs '_body.html') --gfm

# -Encoding UTF8 is required: Get-Content in Windows PowerShell 5.1 otherwise reads
# BOM-less UTF-8 as the ANSI codepage and turns every em dash into mojibake.
$body = Get-Content (Join-Path $docs '_body.html') -Raw -Encoding UTF8
$html = Get-Content (Join-Path $docs '_template.html') -Raw -Encoding UTF8

# The author block is single-newline separated in the markdown, so keep its line breaks.
foreach ($f in 'Date:', 'Status:', 'Roadmap entry:', 'Languages:') {
  $body = $body.Replace("`n<strong>$f</strong>", "<br>`n<strong>$f</strong>")
}

$html = $html.Replace('<!--BODY-->', $body)
Set-Content (Join-Path $docs '_print.html') $html -Encoding utf8

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw 'No Chrome or Edge found for PDF printing.' }

Write-Host "Printing with $chrome"
$pdf = Join-Path $docs 'PROPOSAL.pdf'
$url = 'file:///' + (Join-Path $docs '_print.html').Replace('\', '/')
# Build the argument list as an array: backtick continuations are too easy to break here.
if (Test-Path $pdf) { Remove-Item $pdf }

# A dedicated profile directory keeps this from being handed off to an already-running
# Chrome, which returns immediately and leaves a truncated PDF behind.
$profileDir = Join-Path $env:TEMP ("cadence-print-" + [Guid]::NewGuid().ToString('N'))

$chromeArgs = @(
  '--headless=new',
  '--disable-gpu',
  "--user-data-dir=$profileDir",
  '--no-first-run',
  '--no-pdf-header-footer',
  '--run-all-compositor-stages-before-draw',
  '--virtual-time-budget=5000',
  "--print-to-pdf=$pdf",
  $url
)
Start-Process -FilePath $chrome -ArgumentList $chromeArgs -NoNewWindow -Wait
Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue

if (-not (Test-Path $pdf)) { throw 'Chrome produced no PDF.' }

# Page objects live inside compressed object streams, so count via the page-tree /Count
# instead. Latin1 is not a static property in .NET Framework; ask for it by codepage.
$latin1 = [Text.Encoding]::GetEncoding(28591)
$raw = [IO.File]::ReadAllText($pdf, $latin1)
$counts = [regex]::Matches($raw, '/Type\s*/Pages[^>]*?/Count\s+(\d+)') |
  ForEach-Object { [int]$_.Groups[1].Value }
$pages = if ($counts) { ($counts | Measure-Object -Maximum).Maximum } else { 0 }
if ($pages -lt 2) { throw "PDF came out with $pages page(s) - the print step failed." }
Write-Host "$pages pages"

Remove-Item (Join-Path $docs '_body.html'), (Join-Path $docs '_print.html') -ErrorAction SilentlyContinue
Pop-Location
Write-Host "Done: $pdf"
