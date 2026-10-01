param([string]$Session = 'door-audio')
$ErrorActionPreference = 'Stop'
$repository = Split-Path $PSScriptRoot -Parent
$clips = @(
    @{ Source = 'door_open.ogg'; Output = 'open.wav'; Hash = '62B42CDF0D8B25EF80C0F3BC815AA65977B78B20225481461EA134798172F59D' },
    @{ Source = 'door_close_02.ogg'; Output = 'close.wav'; Hash = '3F4CE43F7A676D8907258908C90E88CAECFFD4526FCE43E40DF6726BF67ED91B' }
)
foreach ($clip in $clips) {
    $source = Join-Path $repository ('assets/audio/doors/' + $clip.Source)
    $destination = Join-Path $repository ('web/public/audio/doors/' + $clip.Output)
    if ((Get-FileHash -LiteralPath $source).Hash -ne $clip.Hash) { throw 'Source hash mismatch' }
    if (Test-Path -LiteralPath $destination) { throw 'Runtime output exists; it will not be overwritten' }
}
# Use a task-owned CLI page at Vite's /proofs/index.html. Retain all samples.
foreach ($clip in $clips) {
    $source = Join-Path $repository ('assets/audio/doors/' + $clip.Source)
    $sourceJson = $source | ConvertTo-Json -Compress
    $expression = "async page => { await page.route('**/proof-source-door.ogg', route => route.fulfill({path:$sourceJson})); try { return await page.evaluate(async () => { const ctx = new OfflineAudioContext(2,48000,48000); const buffer = await ctx.decodeAudioData(await (await fetch('proof-source-door.ogg')).arrayBuffer()); const channels = Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i)); if(buffer.duration <= 0 || buffer.duration > 1 || channels.length !== 2 || channels.some(c=>c.some(x=>!Number.isFinite(x)||Math.abs(x)>=1))) throw new Error('Invalid door source'); const {encodeWaterWave: encodePcm48k} = await import('/proofs/prepare-water-loop.js'); const wav = encodePcm48k(channels); let encoded=''; for(let start=0;start<wav.length;start+=4096) encoded+=String.fromCharCode(...wav.subarray(start,start+4096)); return {base64:btoa(encoded),frames:buffer.length,rate:buffer.sampleRate,channels:buffer.numberOfChannels}; }); } finally { await page.unroute('**/proof-source-door.ogg'); } }"
    $response = (& playwright-cli --session $Session run-code $expression) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "Browser preparation failed: $response" }
    $match = [regex]::Match($response, '(?s)### Result\s*(.*?)\s*### Ran Playwright code')
    if (-not $match.Success) { throw 'Browser result was not structured JSON' }
    $result = $match.Groups[1].Value | ConvertFrom-Json
    $bytes = [Convert]::FromBase64String($result.base64)
    $destination = Join-Path $repository ('web/public/audio/doors/' + $clip.Output)
    [IO.Directory]::CreateDirectory((Split-Path $destination -Parent)) | Out-Null
    $stream = [IO.File]::Open($destination, [IO.FileMode]::CreateNew)
    try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    $result.PSObject.Properties.Remove('base64')
    $result | ConvertTo-Json
    Get-FileHash -LiteralPath $destination
}
