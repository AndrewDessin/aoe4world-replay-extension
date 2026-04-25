# AoE4 Replay Launcher - Setup Script
# Called by install.bat — creates all needed files and registers the native host.

param(
    [string]$ExtensionId,
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'AoE4ReplayLauncher'),
    [switch]$Uninstall
)

$hostName = 'com.aoe4.replay_launcher'
$regPaths = @(
    "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$hostName",
    "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$hostName"
)

if ($Uninstall) {
    foreach ($rp in $regPaths) { Remove-Item $rp -Force -ErrorAction SilentlyContinue }
    if (Test-Path $InstallDir) {
        Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  Uninstalled from $InstallDir"
    return
}

# Create install directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# --- Write aoe4_replay_host.bat ---
$batPath = Join-Path $InstallDir 'aoe4_replay_host.bat'
@'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0aoe4_replay_host.ps1"
'@ | Set-Content $batPath -Encoding ASCII

# --- Write aoe4_replay_host.ps1 ---
$ps1Path = Join-Path $InstallDir 'aoe4_replay_host.ps1'
@'
$REPLAY_API = 'https://aoe-api.worldsedgelink.com/community/leaderboard/getReplayFiles'
$UA = 'AoE4ReplayLauncher/0.3 (https://github.com/spartain-aoe/aoe4world-replay-extension, discord:591850595498065931)'
$AOE4_STEAM_ID = '1466860'
$docsDir = [Environment]::GetFolderPath('MyDocuments')
$playbackDir = Join-Path $docsDir 'My Games\Age of Empires IV\playback'

function Read-Message {
    $stdin = [Console]::OpenStandardInput()
    $lenBuf = New-Object byte[] 4
    $read = $stdin.Read($lenBuf, 0, 4)
    if ($read -lt 4) { return $null }
    $len = [BitConverter]::ToInt32($lenBuf, 0)
    if ($len -le 0 -or $len -gt 1048576) { return $null }
    $msgBuf = New-Object byte[] $len
    $total = 0
    while ($total -lt $len) {
        $n = $stdin.Read($msgBuf, $total, $len - $total)
        if ($n -le 0) { return $null }
        $total += $n
    }
    return ([System.Text.Encoding]::UTF8.GetString($msgBuf) | ConvertFrom-Json)
}

function Write-Message($obj) {
    $json = ($obj | ConvertTo-Json -Compress)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $lenBuf = [BitConverter]::GetBytes([int]$bytes.Length)
    $stdout = [Console]::OpenStandardOutput()
    $stdout.Write($lenBuf, 0, 4)
    $stdout.Write($bytes, 0, $bytes.Length)
    $stdout.Flush()
}

function Invoke-Replay($matchId) {
    if ($matchId -notmatch '^\d+$') {
        return @{ success = $false; error = 'Invalid match ID' }
    }
    $replayName = "AgeIV_Replay_$matchId"
    $replayPath = Join-Path $playbackDir $replayName
    $apiUrl = "${REPLAY_API}?matchIDs=%5B${matchId}%5D&title=age4"
    $response = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = $UA }
    if ($response.result.code -ne 0) {
        return @{ success = $false; error = $response.result.message }
    }
    $replayFile = $response.replayFiles |
        Where-Object { $_.datatype -eq 0 -and $_.size -gt 0 } |
        Sort-Object size -Descending | Select-Object -First 1
    if (-not $replayFile) {
        return @{ success = $false; error = 'No replay file found' }
    }
    $tempFile = [System.IO.Path]::GetTempFileName()
    try {
        Invoke-WebRequest -Uri $replayFile.url -OutFile $tempFile -UserAgent $UA
        $inStream = [System.IO.File]::OpenRead($tempFile)
        $gzStream = New-Object System.IO.Compression.GZipStream(
            $inStream, [System.IO.Compression.CompressionMode]::Decompress)
        $outStream = [System.IO.File]::Create($replayPath)
        $gzStream.CopyTo($outStream)
        $outStream.Dispose(); $gzStream.Dispose(); $inStream.Dispose()
    } finally {
        Remove-Item $tempFile -Force -ErrorAction SilentlyContinue
    }
    Launch-Game $replayName
    return @{ success = $true; replay = $replayName }
}

function Launch-Game($replayName) {
    $proc = Get-Process RelicCardinal -ErrorAction SilentlyContinue
    if ($proc) {
        $proc | ForEach-Object { Stop-Process -Id $_.Id -Force }
        Start-Sleep -Seconds 3
    }
    $steamKey = Get-ItemProperty 'HKCU:\Software\Valve\Steam' -ErrorAction Stop
    & $steamKey.SteamExe -applaunch $AOE4_STEAM_ID -dev -replay "playback:$replayName"
}

function Invoke-ReplayFromData($matchId, $replayB64) {
    if ($matchId -notmatch '^\d+$') {
        return @{ success = $false; error = 'Invalid match ID' }
    }
    $replayName = "AgeIV_Replay_$matchId"
    $replayPath = Join-Path $playbackDir $replayName
    $gzBytes = [Convert]::FromBase64String($replayB64)
    $ms = New-Object System.IO.MemoryStream(,$gzBytes)
    $gzStream = New-Object System.IO.Compression.GZipStream($ms, [System.IO.Compression.CompressionMode]::Decompress)
    $outStream = [System.IO.File]::Create($replayPath)
    $gzStream.CopyTo($outStream)
    $outStream.Dispose(); $gzStream.Dispose(); $ms.Dispose()
    Launch-Game $replayName
    return @{ success = $true; replay = $replayName }
}

$msg = Read-Message
if ($msg -and $msg.action -eq 'launchReplayData' -and $msg.matchId -and $msg.replayB64) {
    try {
        $result = Invoke-ReplayFromData $msg.matchId $msg.replayB64
        Write-Message $result
    } catch {
        Write-Message @{ success = $false; error = $_.Exception.Message }
    }
} elseif ($msg -and $msg.action -eq 'launchReplay' -and $msg.matchId) {
    try {
        $result = Invoke-Replay $msg.matchId
        Write-Message $result
    } catch {
        Write-Message @{ success = $false; error = $_.Exception.Message }
    }
} else {
    Write-Message @{ success = $false; error = 'Invalid message' }
}
'@ | Set-Content $ps1Path -Encoding UTF8

# --- Write native messaging manifest ---
$manifestPath = Join-Path $InstallDir "$hostName.json"
$escapedBat = $batPath.Replace('\', '\\')
@"
{
  "name": "$hostName",
  "description": "AoE4 Replay Launcher - downloads and plays AoE4 replays",
  "path": "$escapedBat",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ExtensionId/"
  ]
}
"@ | Set-Content $manifestPath -Encoding UTF8

# --- Register with Chrome and Edge ---
foreach ($rp in $regPaths) {
    New-Item -Path $rp -Force | Out-Null
    Set-ItemProperty -Path $rp -Name '(Default)' -Value $manifestPath
}

Write-Host "  Installed to $InstallDir"
