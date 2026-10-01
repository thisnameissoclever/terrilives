param([string]$Session = 'shower-water')
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$source = Join-Path $repository 'assets/audio/shower-water/water_flowing.ogg'
$destination = Join-Path $repository 'web/public/audio/objects/shower-water.wav'
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne '1A431F77D61661BECDC87A5B1832D47F83A12A5C0B001077E41A202E739797A7') {
    throw 'Source hash mismatch'
}
if (Test-Path -LiteralPath $destination) { throw 'Runtime output already exists; it will not be overwritten' }
# The named task-owned CLI page must already be at Vite's /proofs/index.html.
$sourceJson = $source | ConvertTo-Json -Compress
$expression = "async page => { await page.route('**/proof-source-water.ogg', route => route.fulfill({path:$sourceJson})); try { return await page.evaluate(async () => (await import('/proofs/prepare-water-loop.js')).prepareWaterRecording(await (await fetch('proof-source-water.ogg')).arrayBuffer())); } finally { await page.unroute('**/proof-source-water.ogg'); } }"
$response = (& playwright-cli --session $Session run-code $expression) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "Browser preparation failed: $response" }
$match = [regex]::Match($response, '(?s)### Result\s*(.*?)\s*### Ran Playwright code')
if (-not $match.Success) { throw 'Browser result was not structured JSON' }
$result = $match.Groups[1].Value | ConvertFrom-Json
$parent = Split-Path $destination -Parent
[IO.Directory]::CreateDirectory($parent) | Out-Null
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
try {
    $bytes = [Convert]::FromBase64String($result.base64)
    $stream.Write($bytes, 0, $bytes.Length)
} finally { $stream.Dispose() }
$result.PSObject.Properties.Remove('base64')
$result | ConvertTo-Json -Depth 4
Get-FileHash -LiteralPath $destination -Algorithm SHA256
