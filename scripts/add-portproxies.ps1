# Bridges WSL VM ports to Windows localhost via netsh portproxy.
# Covers: Prevision Supabase (5442x), Website_Design Supabase (5432x), Honcho (8000, 5433).
# Must run elevated. Idempotent: replaces each rule individually (no reset).
# Usage: add-portproxies.ps1 [<WSL_VM_IP>]  — without arg, the IP is auto-discovered.
$ErrorActionPreference = 'Stop'

$vmip = $args[0]
if (-not $vmip) {
    for ($i = 0; $i -lt 30; $i++) {
        # 'hostname -I' does not exist in the podman machine (no hostname binary);
        # parse eth0's inet line from `ip` instead. Out-String flattens the line
        # array into one string — on an array, -match is a FILTER and never
        # populates $Matches.
        $raw = (wsl -d podman-machine-default -- ip -4 addr show eth0) 2>$null | Out-String
        if ($raw -match 'inet\s+(\d+\.\d+\.\d+\.\d+)') { $vmip = $Matches[1]; break }
        Start-Sleep -Seconds 3
    }
}
if (-not $vmip) { throw 'Could not discover podman WSL VM IP (is the machine started?)' }
Write-Host "WSL VM IP: $vmip"

$ports = 54420, 54421, 54422, 54423, 54424, 54427, 54429,   # Prevision_WebApp
         54321, 54322, 54323, 54324, 54327, 54329,           # Website_Design
         8000, 5433                                          # Honcho

foreach ($p in $ports) {
    netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p | Out-Null
    netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$p connectaddress=$vmip connectport=$p | Out-Null
}
# Honcho 8000 also listens on 0.0.0.0 so Tailscale peers (AWS Hermes) can reach it.
netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=8000 | Out-Null
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=8000 connectaddress=$vmip connectport=8000 | Out-Null

Write-Host 'Portproxy rules now active:'
netsh interface portproxy show all
