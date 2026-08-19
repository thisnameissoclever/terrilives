[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$MechanicalOnly,
    [string]$OutputPath
)

$ErrorActionPreference = 'Stop'

function Get-FreeTcpPort {
    $listener = [System.Net.Sockets.TcpListener]::new(
        [System.Net.IPAddress]::Loopback,
        0
    )
    $listener.Start()
    try {
        return ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
    }
    finally {
        $listener.Stop()
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory)] [string]$Uri,
        [int]$TimeoutSeconds = 30
    )
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 150
        }
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Timed out waiting for $Uri"
}

function Test-OwnedTemporaryPath {
    param(
        [Parameter(Mandatory)] [string]$Path,
        [Parameter(Mandatory)] [string]$RequiredPrefix
    )
    $resolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Path))
    $resolvedTemp = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\')
    $leaf = Split-Path -Leaf $Path
    return $resolvedParent -eq $resolvedTemp -and $leaf.StartsWith($RequiredPrefix)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$webRoot = Join-Path $repoRoot 'web'
$driver = Join-Path $PSScriptRoot 'audio-listening-driver.cjs'
$vite = Join-Path $webRoot 'node_modules\vite\bin\vite.js'

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) {
    throw 'Google Chrome was not found in the standard Windows installation paths.'
}
if (-not (Test-Path -LiteralPath $vite)) {
    throw 'Vite is not installed under web/node_modules. Run npm install only with the owner-approved dependency state.'
}

if (-not $SkipBuild) {
    Push-Location $webRoot
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw "The production web build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$ownedRoot = Join-Path ([System.IO.Path]::GetTempPath()) "terrilives-audio-listening-$stamp-$PID"
if (-not (Test-OwnedTemporaryPath -Path $ownedRoot -RequiredPrefix 'terrilives-audio-listening-')) {
    throw "Refusing to create an unverified temporary path: $ownedRoot"
}
[void](New-Item -ItemType Directory -Path $ownedRoot)
$profilePath = Join-Path $ownedRoot 'chrome-profile'
[void](New-Item -ItemType Directory -Path $profilePath)
$launchProofPath = Join-Path $ownedRoot 'chrome-launch.json'

if (-not $OutputPath) {
    $reportRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'terrilives-audio-listening-reports'
    [void](New-Item -ItemType Directory -Force -Path $reportRoot)
    $OutputPath = Join-Path $reportRoot "audio-listening-$stamp.json"
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

$previewPort = Get-FreeTcpPort
do {
    $debugPort = Get-FreeTcpPort
} while ($debugPort -eq $previewPort)
$gameUrl = "http://127.0.0.1:$previewPort/?stress=1"
$debugUrl = "http://127.0.0.1:$debugPort"

$previewProcess = $null
$chromeProcess = $null
$driverExit = 1
try {
    $previewProcess = Start-Process -FilePath (Get-Command node.exe).Source `
        -ArgumentList @(
            $vite,
            'preview',
            '--host', '127.0.0.1',
            '--port', [string]$previewPort,
            '--strictPort'
        ) `
        -WorkingDirectory $webRoot `
        -WindowStyle Hidden `
        -PassThru
    Wait-ForHttp -Uri $gameUrl

    $chromeArguments = @(
        "--remote-debugging-port=$debugPort",
        "--user-data-dir=$profilePath",
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        $gameUrl
    )
    $chromeProcess = Start-Process -FilePath $chrome `
        -ArgumentList $chromeArguments `
        -PassThru

    @{
        schema = 1
        launchedBy = 'audio-listening.ps1'
        executable = $chrome
        processId = $chromeProcess.Id
        profilePath = $profilePath
        arguments = $chromeArguments
        previewProcessId = $previewProcess.Id
        gameUrl = $gameUrl
        createdAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $launchProofPath -Encoding utf8NoBOM

    Wait-ForHttp -Uri "$debugUrl/json/version"

    $driverArguments = @(
        $driver,
        '--cdp', $debugUrl,
        '--game-url', $gameUrl,
        '--launch-proof', $launchProofPath,
        '--output', $OutputPath
    )
    if ($MechanicalOnly) {
        $driverArguments += '--mechanical-only'
    }
    & node.exe @driverArguments
    $driverExit = $LASTEXITCODE
}
finally {
    if ($chromeProcess) {
        for ($attempt = 0; $attempt -lt 8; $attempt += 1) {
            $ownedChrome = Get-CimInstance Win32_Process | Where-Object {
                $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=$profilePath")
            }
            foreach ($process in $ownedChrome) {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            }
            if (-not $ownedChrome) {
                break
            }
            Start-Sleep -Milliseconds 250
        }
    }
    if ($previewProcess -and -not $previewProcess.HasExited) {
        Stop-Process -Id $previewProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $ownedRoot) {
        if (-not (Test-OwnedTemporaryPath -Path $ownedRoot -RequiredPrefix 'terrilives-audio-listening-')) {
            throw "Refusing to remove an unverified temporary path: $ownedRoot"
        }
        for ($attempt = 0; $attempt -lt 8; $attempt += 1) {
            try {
                Remove-Item -LiteralPath $ownedRoot -Recurse -Force
                break
            }
            catch {
                if ($attempt -eq 7) {
                    throw
                }
                Start-Sleep -Milliseconds 250
            }
        }
    }
}

Write-Host "Listening report: $OutputPath"
exit $driverExit
