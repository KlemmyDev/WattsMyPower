# Install or update WattsMyPower on Windows 11, in its own WSL (Linux) distribution with Docker.
#
#   In PowerShell:  irm https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.ps1 | iex
#
# -Channel nightly|beta|stable follows that release channel from now on, as install.sh's --channel does (otherwise
# the one chosen in the dashboard, Manage → System → Updates; beta for a new install). Piped in from irm, it's passed
# like this:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.ps1))) -Channel stable
#
# It asks to run as administrator, then:
#   - installs WSL if it's missing (that needs a restart: it carries on by itself after you sign in)
#   - creates a WSL distribution called WattsMyPower (Ubuntu 24.04) with systemd, so Docker runs as a service
#   - turns on WSL's mirrored networking, so the dashboard is at this PC's own address
#   - runs install.sh in it, which installs Docker and WattsMyPower (time zone from Windows, port 8080)
#   - lets the dashboard's port through the firewall
#   - adds a scheduled task, WattsMyPower, that starts it with Windows, before anyone signs in
#
# Run it again to update. Everything else is done inside the distribution: wsl -d WattsMyPower
# (the app is in ~/wattsmypower; see the README's Everyday use).

# No [ValidateSet] here: piped into iex, this block runs as a plain assignment in the caller's session, where
# the attribute rejects the empty default ("The attribute cannot be added because variable Channel ...").
param(
    [string]$Channel = ''
)

$WmpSelf = $PSCommandPath  # empty when piped in from irm

function Install-WattsMyPower {
    param([string]$Self, [string]$Channel)

    $url = 'https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.ps1'
    $installSh = 'https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh'
    $distro = 'WattsMyPower'
    $image = 'Ubuntu-24.04'
    $wslVm = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'  # the Hyper-V firewall's ID for WSL
    $wsl = Join-Path $env:windir 'System32\wsl.exe'
    $env:WSL_UTF8 = '1'  # wsl.exe prints UTF-16 otherwise
    # How to run this again (as administrator, or after a restart): from its file, or from GitHub, with the channel
    $again = if ($Self) { "& '$Self'" } elseif ($Channel) { "& ([scriptblock]::Create((irm $url)))" } else { "irm $url | iex" }
    if ($Channel) { $again += " -Channel $Channel" }
    $options = if ($Channel) { "--yes --channel $Channel" } else { '--yes' }  # for install.sh

    function Say([string]$text) { Write-Host ''; Write-Host $text -ForegroundColor Cyan }
    function Info([string]$text) { Write-Host "  $text" }
    function Fail([string]$text) { throw $text }
    function InDistro([string]$command) { & $wsl -d $distro -u root --exec bash -c $command }

    # ------------------------------------------------------------ as administrator, on Windows 11
    $admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $admin) {
        Info 'Asking to run as administrator (it sets up WSL, the firewall and a scheduled task)...'
        Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoExit -ExecutionPolicy Bypass -Command $again"
        return
    }
    $build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
    if ($build -lt 22621) {
        Fail ('WattsMyPower needs Windows 11 22H2 or later on Windows (for WSL''s mirrored networking, which lets ' +
              'other devices reach the dashboard). Windows Update can bring this PC up to date; or run it on a ' +
              'Linux machine instead (see the README).')
    }

    # ------------------------------------------------------------ WSL
    $vmp = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    if ($vmp.State -ne 'Enabled') {
        Say 'Installing WSL'
        & $wsl --install --no-distribution
        if ($LASTEXITCODE -ne 0) { Fail 'WSL could not be installed (see above).' }
        Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'WattsMyPower' `
            -Value "powershell.exe -NoExit -ExecutionPolicy Bypass -Command $again"
        Say 'Windows needs to restart to finish installing WSL.'
        Info 'After you sign in again, this carries on by itself (approve the administrator prompt).'
        if ((Read-Host '  Restart now? [Y/n]') -notmatch '^[Nn]') { Restart-Computer }
        return
    }
    Say 'Updating WSL'
    & $wsl --update
    if ($LASTEXITCODE -ne 0) { Write-Warning 'WSL could not be updated; carrying on with the version installed.' }

    # Mirrored networking (in .wslconfig, for all of this user's WSL distributions): WSL shares this
    # PC's address, so the dashboard is at http://<this PC>:8080 and Docker can reach the inverter.
    $config = Join-Path $env:USERPROFILE '.wslconfig'
    $lines = @(if (Test-Path $config) { Get-Content $config })
    $out = New-Object System.Collections.Generic.List[string]
    $section = ''; $set = $false; $changed = $false
    foreach ($line in $lines) {
        if ($line -match '^\s*\[(.+)\]\s*$') {
            if ($section -eq 'wsl2' -and -not $set) { $out.Add('networkingMode=mirrored'); $set = $true; $changed = $true }
            $section = $Matches[1].Trim().ToLower()
        } elseif ($section -eq 'wsl2' -and $line -match '^\s*networkingMode\s*=\s*(.*?)\s*$') {
            if ($Matches[1] -ne 'mirrored') { $line = 'networkingMode=mirrored'; $changed = $true }
            $set = $true
        }
        $out.Add($line)
    }
    if (-not $set) {
        if ($section -ne 'wsl2') { $out.Add('[wsl2]') }
        $out.Add('networkingMode=mirrored'); $changed = $true
    }
    if ($changed) {
        Say 'Turning on mirrored networking for WSL'
        [IO.File]::WriteAllLines($config, $out)  # UTF-8 without a byte order mark
        Info "Set networkingMode=mirrored in $config. Restarting WSL to use it."
        & $wsl --shutdown
    }

    # ------------------------------------------------------------ the WattsMyPower distribution
    $distros = @(& $wsl --list --quiet 2>$null | ForEach-Object { $_.Trim() })
    if ($distros -notcontains $distro) {
        Say "Creating the $distro WSL distribution ($image)"
        & $wsl --install $image --name $distro --no-launch
        if ($LASTEXITCODE -ne 0) {
            Fail ('It could not be created (see above). If WSL says virtualization is off, turn it on in this ' +
                  'PC''s BIOS or UEFI settings (often called Intel VT-x, AMD-V or SVM) and run this again.')
        }
    }
    # Docker runs as a service, so the distribution needs systemd.
    InDistro 'test -d /run/systemd/system'
    if ($LASTEXITCODE -ne 0) {
        Info 'Turning on systemd in it'
        InDistro "printf '[boot]\nsystemd=true\n' > /etc/wsl.conf"
        & $wsl --terminate $distro | Out-Null
        foreach ($i in 1..10) {
            InDistro 'test -d /run/systemd/system'
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Seconds 1
        }
        if ($LASTEXITCODE -ne 0) { Fail "systemd didn't start in the $distro distribution. Run 'wsl --update' and try again." }
    }
    InDistro 'systemctl is-system-running --wait >/dev/null 2>&1 || true'

    # ------------------------------------------------------------ install or update WattsMyPower
    # --yes: no questions (the time zone follows Windows'; the port is 8080). To change them later:
    # wsl -d WattsMyPower, then bash ~/wattsmypower/install.sh --configure. And --channel, if -Channel was given.
    Say "Running install.sh in $distro"
    InDistro "cd ~ && if [ -f wattsmypower/install.sh ]; then exec bash wattsmypower/install.sh $options; else curl -fsSL $installSh | bash -s -- $options; fi"
    if ($LASTEXITCODE -ne 0) { Fail 'install.sh stopped (see above). Run this again once that is sorted.' }

    # ------------------------------------------------------------ reachable from the network, and always on
    $port = (InDistro "sed -n 's/^PORT=//p' ~/wattsmypower/.env" | Select-Object -First 1)
    if (-not "$port".Trim()) { $port = '8080' }
    $port = "$port".Trim()
    Remove-NetFirewallHyperVRule -Name $distro -ErrorAction SilentlyContinue
    New-NetFirewallHyperVRule -Name $distro -DisplayName 'WattsMyPower dashboard' -Direction Inbound `
        -VMCreatorId $wslVm -Protocol TCP -LocalPorts $port | Out-Null
    Info "Let port $port through the firewall, so other devices can open the dashboard."

    # WSL stops a distribution once nothing is using it, and only starts it when asked. This task
    # starts it with Windows (before anyone signs in) and keeps it running; Docker restarts the app.
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute $wsl -Argument "-d $distro -u root --exec sleep infinity"
    $triggers = @((New-ScheduledTaskTrigger -AtStartup), (New-ScheduledTaskTrigger -AtLogOn -User $me))
    $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType S4U -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
        -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $distro -Description 'Keeps the WattsMyPower WSL distribution (and the dashboard in it) running.' `
        -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Force | Out-Null
    Start-ScheduledTask -TaskName $distro
    Info "Added the $distro scheduled task: it starts with Windows, even before anyone signs in."

    $sleep = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting Index:\s*0x([0-9a-f]+)')
    if ($sleep -and [Convert]::ToInt32($sleep.Matches[0].Groups[1].Value, 16) -ne 0) {
        if ((Read-Host '  It only records while this PC is awake. Stop it sleeping while plugged in? [Y/n]') -notmatch '^[Nn]') {
            powercfg /change standby-timeout-ac 0
            powercfg /change hibernate-timeout-ac 0
            Info 'This PC no longer sleeps while plugged in (the screen still turns off).'
        }
    }

    Say 'Done. To update later, run the same command again.'
    Info "For everything else: wsl -d $distro, then cd ~/wattsmypower (see the README's Everyday use)."
}

try {
    $Channel = "$Channel".Trim().ToLower()
    if ($Channel -and $Channel -notin 'nightly', 'beta', 'stable') {
        throw "-Channel must be nightly, beta or stable (not '$Channel')."
    }
    Install-WattsMyPower -Self $WmpSelf -Channel $Channel
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message -ForegroundColor Red
}
