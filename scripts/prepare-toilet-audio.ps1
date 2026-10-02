param([string]$Session = 'toilet-audio')
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$source = Join-Path $repository 'assets/audio/toilet/toilet_02.ogg'
$destination = Join-Path $repository 'web/public/audio/toilet/flush.wav'
if ((Get-FileHash -LiteralPath $source).Hash -ne '9E4A1824AC584BB65BA32406155D37861DF7E11B95EF62493246DD2DA17F8DBC') {
    throw 'Source hash mismatch'
}
if (Test-Path -LiteralPath $destination) { throw 'Runtime output exists; it will not be overwritten' }
# Use a task-owned CLI page at Vite's /proofs/index.html. Preserve every sample.
$sourceJson = $source | ConvertTo-Json -Compress
$expression = "async page => { await page.route('**/proof-source-toilet.ogg', route => route.fulfill({path:$sourceJson})); try { return await page.evaluate(async () => { const ctx = new OfflineAudioContext(2,48000,48000); const buffer = await ctx.decodeAudioData(await (await fetch('proof-source-toilet.ogg')).arrayBuffer()); const channels = Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)); if(buffer.length !== 197986 || channels.length !== 2 || channels.some(c=>c.some(x=>!Number.isFinite(x)||Math.abs(x)>=1))) throw new Error('Invalid toilet source'); const {encodeWaterWave: encodePcm48k} = await import('/proofs/prepare-water-loop.js'); const wav = encodePcm48k(channels); let encoded=''; for(let start=0;start<wav.length;start+=4096) encoded+=String.fromCharCode(...wav.subarray(start,start+4096)); return {base64:btoa(encoded),frames:buffer.length,rate:buffer.sampleRate,channels:buffer.numberOfChannels}; }); } finally { await page.unroute('**/proof-source-toilet.ogg'); } }"
$response = (& playwright-cli --session $Session run-code $expression) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "Browser preparation failed: $response" }
$match = [regex]::Match($response, '(?s)### Result\s*(.*?)\s*### Ran Playwright code')
if (-not $match.Success) { throw 'Browser result was not structured JSON' }
$result = $match.Groups[1].Value | ConvertFrom-Json
$bytes = [Convert]::FromBase64String($result.base64)
[IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
$stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
$result.PSObject.Properties.Remove('base64')
$result | ConvertTo-Json
Get-FileHash -LiteralPath $destination
