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
#   - installs WSL if it's missing, with the virtualization it needs: the Virtual Machine Platform feature and
#     Windows' hypervisor, or, if it's off in the PC's firmware, a restart into the firmware settings to turn it on
#     (these need a restart, which it does after a minute's warning: it carries on by itself after you sign in)
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
    $resume = 'WattsMyPower setup'  # the one-off task that carries on after a restart
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
    # Carrying on after a restart: it's done its job (and so has an older version's RunOnce entry).
    Unregister-ScheduledTask -TaskName $resume -Confirm:$false -ErrorAction SilentlyContinue
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name 'WattsMyPower' `
        -ErrorAction SilentlyContinue
    $build = [int](Get-CimInstance Win32_OperatingSystem).BuildNumber
    if ($build -lt 22621) {
        Fail ('WattsMyPower needs Windows 11 22H2 or later on Windows (for WSL''s mirrored networking, which lets ' +
              'other devices reach the dashboard). Windows Update can bring this PC up to date; or run it on a ' +
              'Linux machine instead (see the README).')
    }

    # ------------------------------------------------------------ WSL, and the virtualization it needs
    # WSL 2 runs Linux in a small virtual machine. That needs the Virtual Machine Platform feature, virtualization
    # turned on in the PC's firmware (BIOS/UEFI), and Windows starting its hypervisor at boot. None of them take
    # effect without a restart, so this sorts out everything it can first, then restarts once and carries on.
    function RestartAndCarryOn([string]$why, [switch]$Firmware) {
        # After the restart, a one-off task runs this again as administrator once you sign in, without asking
        # again (30 seconds in, so the network is up). It removes itself when it runs.
        $me = [Security.Principal.WindowsIdentity]::GetCurrent().Name
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoExit -ExecutionPolicy Bypass -Command $again"
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $me
        $trigger.Delay = 'PT30S'
        $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $resume -Description 'Carries on setting up WattsMyPower after a restart.' `
            -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
        Say $why
        Info 'After you sign in again, this carries on by itself in a minute or so.'
        if ($Firmware) {
            Read-Host '  Press Enter to restart into them' | Out-Null
            shutdown.exe /r /fw /t 0  # straight into the UEFI settings
            if ($LASTEXITCODE -eq 0) { return }
            Info ('This PC can''t restart straight into its firmware settings. As it starts, press the key it shows ' +
                  'for Setup (often F2, F10, Del or Esc).')
            Read-Host '  Press Enter to restart' | Out-Null
            Restart-Computer
            return
        }
        Info 'Restarting in 60 seconds: save anything you have open. (To restart later yourself instead: shutdown /a)'
        shutdown.exe /r /t 60 /c 'Restarting to finish setting up WattsMyPower. It carries on by itself after you sign in.'
    }
    # A change to how Windows boots, or to the firmware settings, can make BitLocker ask for its recovery key.
    # Pausing it until the next restart avoids that; it turns itself back on after.
    function PauseBitLockerOnce {
        $volume = try { Get-BitLockerVolume -MountPoint $env:SystemDrive -ErrorAction Stop } catch { $null }  # not on every edition
        if ($volume -and $volume.ProtectionStatus -eq 'On') {
            Suspend-BitLocker -MountPoint $env:SystemDrive -RebootCount 1 | Out-Null
            Info 'Paused BitLocker until the next restart, so it doesn''t ask for its recovery key.'
        }
    }

    $restart = $false
    $vmp = (Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform).State
    if ($vmp -notin 'Enabled', 'EnablePending') {
        Say 'Installing WSL'
        & $wsl --install --no-distribution
        if ($LASTEXITCODE -ne 0) { Fail 'WSL could not be installed (see above).' }
        # Normally done by wsl --install already; this makes sure of it.
        Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -All -NoRestart | Out-Null
        $restart = $true
    } elseif ($vmp -eq 'EnablePending') {
        $restart = $true  # turned on, but Windows hasn't restarted since
    }

    $computer = Get-CimInstance Win32_ComputerSystem
    if (-not $computer.HypervisorPresent) {
        # Windows only reports the firmware setting while its hypervisor isn't running, as here.
        $firmwareOff = (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled -eq $false
        if ($firmwareOff -and $computer.Model -match 'Virtual|VMware|Parallels|KVM|QEMU') {
            Fail ('This Windows is itself a virtual machine without nested virtualization, which WSL 2 needs. Turn ' +
                  'on nested virtualization for it in the program running it, then run this again.')
        }
        # Turned off at boot: some games' anti-cheat and older VirtualBox or VMware ask for that.
        $launch = bcdedit.exe /enum '{current}' | Select-String 'hypervisorlaunchtype\s+(\S+)' |
            ForEach-Object { $_.Matches[0].Groups[1].Value }
        if ($launch -and $launch -ne 'Auto') {
            Info 'Windows is set not to start its hypervisor, which WSL needs. Setting hypervisorlaunchtype to Auto.'
            PauseBitLockerOnce
            $result = bcdedit.exe /set '{current}' hypervisorlaunchtype auto 2>&1
            if ($LASTEXITCODE -ne 0) { Fail "It could not be changed: $result" }
            $restart = $true
        }
        if ($firmwareOff) {
            # Windows can't change this one. Restarting into the firmware settings also finishes anything above.
            PauseBitLockerOnce
            RestartAndCarryOn -Firmware ('Virtualization is turned off in this PC''s firmware (BIOS/UEFI) ' +
                'settings, and WSL needs it. Restart into them, turn it on (usually under Advanced or CPU ' +
                'Configuration, called Intel Virtualization Technology or VT-x, AMD-V or SVM Mode), then save ' +
                'and exit.')
            return
        }
    }
    if ($restart) {
        RestartAndCarryOn 'Windows needs to restart to finish setting up WSL.'
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
