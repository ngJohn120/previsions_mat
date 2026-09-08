# Runs at logon (scheduled task "BootStack-Honcho"):
# 1. starts the podman machine (no-op if already running)
# 2. brings up the Honcho compose stack (no-op if already up)
# 3. refreshes all portproxy rules with the current WSL VM IP
# Safe to run repeatedly; also runnable by hand: powershell -File boot-honcho.ps1
$ErrorActionPreference = 'Continue'
$podman = "$env:LOCALAPPDATA\Programs\Podman\podman.exe"
$env:DOCKER_HOST = 'npipe:////./pipe/podman-machine-default'

# --- 1. podman machine ---
$state = (& $podman machine inspect podman-machine-default 2>$null | ConvertFrom-Json)[0].State
if ($state -ne 'Running') {
    Write-Host "starting podman machine (state: $state)..."
    & $podman machine start | Out-Null
    Start-Sleep -Seconds 5
} else {
    Write-Host 'podman machine already running'
}

# wait for the API pipe to answer (max ~60s)
for ($i = 0; $i -lt 20; $i++) {
    if (& $podman info --format '{{.Version.Version}}' 2>$null) { break }
    Start-Sleep -Seconds 3
}

# --- 2. Honcho stack (idempotent) ---
Write-Host 'ensuring Honcho compose stack...'
& $podman compose -f 'C:\Users\Administrator\honcho\docker-compose.yml' up -d 2>&1 | Out-Null

# --- 3. portproxy refresh (auto-discovers IP) ---
Write-Host 'refreshing portproxy rules...'
try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File `
      'C:\Users\Administrator\Documents\MEGA\Documents\SILOE\Prevision_WebApp\scripts\add-portproxies.ps1'
} catch {
    Write-Warning "portproxy refresh failed: $_"
}
Write-Host 'boot-honcho done.'
