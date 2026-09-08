# Adds localhost portproxy bridges WSL-VM -> Windows for the Prevision WebApp
# Supabase stack (remapped to 5442x to avoid the Website_Design stack on 5432x).
# Must run elevated. Safe to re-run (removes existing entries for these ports first).
$ErrorActionPreference = 'Stop'
$vmip = $args[0]
if (-not $vmip) { throw 'usage: add-prevision-portproxy.ps1 <WSL_VM_IP>' }

netsh interface portproxy reset | Out-Null
foreach ($p in 54420, 54421, 54422, 54423, 54424, 54427, 54429) {
    netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$p connectaddress=$vmip connectport=$p | Out-Null
}
Write-Host 'Portproxy rules now active:'
netsh interface portproxy show all
