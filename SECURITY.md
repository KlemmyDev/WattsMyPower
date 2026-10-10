# Security policy

WattsMyPower runs on your home network and can change what your inverter and battery do, so security problems matter
even though it isn't meant to face the internet. Thank you for reporting them carefully.

## Reporting a vulnerability

Please report it privately, not in a public issue:

1. Go to the repository's **[Security](https://github.com/KlemmyDev/WattsMyPower/security)** tab.
2. Choose **Report a vulnerability** (GitHub's private vulnerability reporting).
3. Say what's affected, how to reproduce it, and what someone could do with it. The version and commit from
   **Manage → System → Updates** help.

Only the maintainers see the report. We aim to reply within a week, and keep you posted while it's fixed.
Once a fix is released, the advisory is published, crediting you unless you'd rather not be named.

## What counts

Anything that lets someone do more than they should, for example:

- **Controlling the battery or inverter:** changing its mode, charging it from the grid or changing its reserve
  without signing in, or writing registers the dashboard isn't meant to.
- **Stored credentials:** getting at the household account's password or sessions, or the accounts and keys kept
  for integrations (TP-Link, Shelly, Hisense ConnectLife, EcoFlow, Home Assistant, Tessie, Amber, a Tesla's Bluetooth
  key), or sending them anywhere but their own service.
- **Getting past sign-in** to the dashboard or its API, or reading the collector's feed without its token.
- **Running anything on the server**, or reaching its files, through the dashboard, the collector, `install.sh` or
  `updater.sh`.
- Data leaving the home that shouldn't, such as the street matched against outage maps.

Not in scope: the dashboard being served over plain HTTP on your own network (it's documented, and it isn't meant to
be port-forwarded), problems that need someone already signed in as the household's account, and issues in Sungrow's,
TP-Link's or other companies' own devices and services (report those to them).

## Supported versions

Fixes go into the latest release only. While WattsMyPower is in beta, that's the latest beta (and `main`, which the
nightly channel follows). Update to it before reporting, if you can.
