param([Parameter(Mandatory=$true)][string]$ManifestPath, [ValidateSet('render','cached')][string]$Job = 'render')
$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$output = Split-Path -Parent $ManifestPath
function Get-FreeGiB {
    return (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB
}
foreach ($item in $manifest.inputs.PSObject.Properties) {
    if ((Get-FileHash -LiteralPath $item.Name -Algorithm SHA256).Hash.ToLower() -ne $item.Value) {
        throw "Frozen input changed: $($item.Name)"
    }
}
$launchFree = Get-FreeGiB
if ($launchFree -lt 6) { throw "Blender requires 6 GiB free; current $launchFree GiB" }
$start = [Diagnostics.ProcessStartInfo]::new()
$start.FileName = 'C:/Users/myema/AppData/Local/Microsoft/WindowsApps/blender-launcher.exe'
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$arguments = @('--background','--threads','2','--python-exit-code','1','--python',$manifest.jobs.($Job + "_script"),'--',$ManifestPath,$manifest.outputs.$Job)
foreach ($argument in $arguments) { $start.ArgumentList.Add($argument) }
$launcher = [Diagnostics.Process]::Start($start)
$clock = [Diagnostics.Stopwatch]::StartNew()
$writer = $null
$samples = [Collections.Generic.List[object]]::new()
$stopReason = $null
$nextSample = 0
$receiptPath = Join-Path $manifest.outputs.$Job 'proof.json'
try {
    while ($true) {
        if ($null -eq $writer -and (Test-Path -LiteralPath $receiptPath)) {
            try {
                $raw = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
                $writer = [Diagnostics.Process]::GetProcessById([int]$raw.pid)
                $null = $writer.Handle
            } catch { }
        }
        if ($null -ne $writer -and $writer.HasExited) { break }
        $free = Get-FreeGiB
        if ($clock.Elapsed.TotalSeconds -ge $nextSample) {
            $samples.Add(@{ elapsed_seconds=$clock.Elapsed.TotalSeconds; free_gib=$free })
            $nextSample += 10
        }
        if ($free -lt 4 -or $clock.Elapsed.TotalSeconds -gt 240) {
            $stopReason = if ($free -lt 4) { 'Own writer stopped below 4 GiB free' } else { 'Own writer exceeded 240 seconds' }
            $samples.Add(@{ elapsed_seconds=$clock.Elapsed.TotalSeconds; free_gib=$free; stop_reason=$stopReason })
            if ($null -eq $writer) { throw 'Cannot retain the writer handle for a safe own-process stop' }
            $writer.Kill()
            $writer.WaitForExit()
            break
        }
        if ($null -eq $writer -and $launcher.HasExited -and $clock.Elapsed.TotalSeconds -gt 20) {
            throw 'Launcher exited without a retained actual writer handle'
        }
        Start-Sleep -Milliseconds 500
    }
    $writer.WaitForExit()
} finally {
    $unchanged = $true
    foreach ($item in $manifest.inputs.PSObject.Properties) {
        if ((Get-FileHash -LiteralPath $item.Name -Algorithm SHA256).Hash.ToLower() -ne $item.Value) { $unchanged = $false }
    }
    $exitCode = if ($null -ne $writer -and $writer.HasExited) { $writer.ExitCode } else { $null }
    $record = @{ launcher_pid=$launcher.Id; writer_pid=if ($null -ne $writer) {$writer.Id} else {$null}; actual_handle_retained=($null -ne $writer); exit_code=$exitCode; elapsed_seconds=$clock.Elapsed.TotalSeconds; launch_free_gib=$launchFree; memory_samples=$samples; stop_reason=$stopReason; inputs_unchanged=$unchanged }
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output ($Job + '-process-exit.json')) -Encoding utf8
}
if ($exitCode -ne 0 -or -not $unchanged -or $null -ne $stopReason) { throw 'Saved-scene render did not complete successfully' }
$final = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($final.state -ne 'complete') { throw 'Four-view receipt is incomplete' }
$record | ConvertTo-Json -Depth 8
