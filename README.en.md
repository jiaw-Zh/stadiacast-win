# Stadia Controllers over Wi-Fi as Xbox pads on Windows

[中文说明](README.md)

A field report. Two Stadia Controllers that had been switched to Bluetooth mode were flashed back to their Wi-Fi firmware, joined to a home network behind an OpenWrt router, and turned into two Xbox 360 pads on a Windows PC by [stadiacast](https://github.com/jkfran/stadiacast). Buttons, sticks, triggers and game rumble work, with both controllers connected at once.

What is here:

- **The steps**, from finding out which firmware a controller runs to playing, with the traps marked. stadiacast's own docs centre on a macOS hotspot; this covers Windows with an OpenWrt router.
- **The pitfalls** we hit and how each was solved.
- **A small local web console** (`webui\`), in English or Chinese: start and stop stadiacast, see each controller live (link, battery, player, buttons and sticks), send a test rumble. Switch the language at the top right, or open http://127.0.0.1:8090/?lang=en .

The detailed docs under `docs\` are in Chinese. This page carries the steps and the tips in short.

This project is not affiliated with Google or with stadiacast, and contains no firmware.

## Is it for you?

| Your situation | |
|---|---|
| You only want the controller on a PC and do not need rumble | Keep the Bluetooth firmware and pair it. Much simpler |
| You want Wi-Fi straight to the PC, rumble on Windows, several controllers, or the headset jack | This is for you |
| The controller still runs its Wi-Fi firmware | Skip the flashing step |
| The controller runs the Bluetooth firmware | It has to be flashed back first, which carries a risk of bricking it |
| Your router cannot hand a DNS server to one device | You need another way to make the PC the controller's DNS server, e.g. a hotspot on the PC (see stadiacast [#18](https://github.com/jkfran/stadiacast/issues/18) for Windows) |

## What you need

- A desktop Windows 10/11 PC with Bluetooth. Windows Server lacks the Xbox 360 pad driver.
- An OpenWrt / ImmortalWrt router you can reach over SSH.
- A WPA2-Personal (AES) network with PMF and client isolation off. No WPA3.
- A USB data cable and Chrome or Edge, for flashing.
- [uv](https://docs.astral.sh/uv/), which installs stadiacast and its Python.

## Steps

Example addresses: router `192.168.1.1`, PC `192.168.1.100`, controllers `192.168.1.201` and `.202`.

1. **Install stadiacast and the pad driver.**
   ```powershell
   $env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'
   uv tool install "stadiacast[ble,gamepad]==1.3.0"
   ```
   Then install [ViGEmBus](https://github.com/nefarius/ViGEmBus/releases) 1.22.0. Device Manager should list *Nefarius Virtual Gamepad Emulation Bus* under System devices.

2. **Find out which firmware each controller runs.** The blinking orange light looks the same in both modes, so check it one of two ways.
   - **With a USB data cable (simplest).** Plug the controller in and open the community flasher, https://luigimannoni.github.io/stadia-controller-flasher/ , in Chrome or Edge.
     1. Under **Check mode and updates**, choose **Check**, then **Allow Chrome to verify**, and pick the controller.
     2. It reads the firmware build and says *Your controller is in Stadia Wi-Fi mode*, or that it is in Bluetooth mode. In its code, builds up to 320480 are Wi-Fi.
     3. It also reads the serial number and refuses the ones it cannot flash.
     
     Checking only reads. Do not accept a Bluetooth update if it offers one.
   - **Over Bluetooth, no cable.** Put the controller in setup or pairing mode (step 4), then run the detection script:
     ```powershell
     & (Join-Path (uv tool dir) 'stadiacast\Scripts\python.exe') scripts\find-controllers.py
     ```
     - Wi-Fi firmware in setup mode exposes the setup service `0xFEA0`.
     - Bluetooth firmware advertises a name like `StadiaXXXX-xxxx`, where XXXX is the end of the serial number.

3. **Bluetooth firmware only: flash the Wi-Fi firmware back** with the community flasher, https://luigimannoni.github.io/stadia-controller-flasher/ , opened in Chrome or Edge with no URL parameters. It writes Google's signed `ota.316382 gotham-pvt-b`. Its author warns it may brick the controller.
   1. Charge for 30 minutes first; the page refuses below 10 %.
   2. Mind the serial number, which the check above reads. The flasher refuses serials starting 91–94, and 95–97 are engineering units with no Wi-Fi image.
   3. Choose **Revert to Wi-Fi mode (Dogfood only)**.
   4. Unlock: unplug; hold the ⋯ (Options) button while plugging in; then press ⋯, Assistant, A and Y together. Nothing visible happens.
   5. Pick **SP Blank RT Family** in the device dialog, then **USB COMPOSITE DEVICE**. Do not unplug while it writes.
   6. Stuck? Unplug, hold the Stadia button for 10 s, and start again from the unlock.

4. **Put the Wi-Fi credentials on the controller.**
   1. Enter setup mode: **unplug the USB cable**, hold the Stadia button for 4 s to turn it off, then hold Y and press the Stadia button until the light blinks orange.
   2. Write the credentials:
      ```powershell
      stadiacast-provision scan
      stadiacast-provision provision --address <ADDR> --ssid <your SSID>   # prompts for the password
      ```
   3. `Done` means it has them. The address changes every time setup mode is entered, so scan again each time.

5. **Router: the PC as DNS server for the controllers only.**
   1. Give the PC and each controller a static lease in LuCI. Controllers appear as `Stadia-xxxx` with the MAC prefix `F0:EF:86`.
   2. Edit and run `scripts\router-dhcp-tag.sh` over SSH. It creates a dnsmasq tag with DHCP option 6 set to the PC alone, and puts the controllers' leases under it.
   3. Check with `grep -h stadia /var/etc/dnsmasq.conf.*`.

6. **Console settings and firewall.**
   1. Double-click `stadia-console.cmd` (http://127.0.0.1:8090/).
   2. Enter the upstream DNS and the controllers' IPs under Settings.
   3. Run `scripts\firewall.ps1 -RemoveAutoRules` in an administrator PowerShell. It opens UDP 53, UDP 40000–40007 and TCP 53/443 to the controllers' IPs only.

7. **Start stadiacast from the console and wake the controllers**, about 1 s on the Stadia button each. Two short rumbles and a steady white light mean connected; the pad appears about 8 s after the wake. The order of waking sets the player numbers.

The console and `scripts\start-stadiacast.ps1` start stadiacast the same way:

```
stadiacast --preset live --no-sntp --dns-upstream <router> --controller-ip <first controller> `
  --dns-redirect time.google.com,clients3.google.com --stadiaconfig 'json:{}' --gamepad vigem
```

- `--no-sntp`: Windows Time holds UDP 123, and the controller takes the time from HTTP anyway.
- `clients3.google.com` with `--stadiaconfig 'json:{}'`: the controller's configuration request is answered locally, so a network that cannot reach Google does not hold it up. With it the controllers connected normally; we did not try without it.

## Tips

- **No orange light in setup mode?** Unplug the USB cable. On USB power the controller turns itself back on.
- **The first boot after provisioning never connects.** The light keeps blinking white. Give it a minute, turn it off, wake it again.
- **Prepare the router and PC before provisioning.** A controller that boots against Google's real hosts can fall back to setup mode on its own. We saw this once; the cause is our inference.
- **Provision one controller at a time.** In setup mode the advertisement carries no name, so two controllers cannot be told apart.
- **DNS for the controllers only, and only the PC in it.**
  - Handing the PC to the whole LAN breaks Google services on every other device.
  - A second, public DNS server in the list lets the controller resolve Google's real addresses.
- **Older LuCI cannot create dnsmasq tags**; use the command line. Nothing changes until `/etc/init.d/dnsmasq restart`.
- **Windows Firewall creates rules for the Python that runs stadiacast** the first time it listens.
  - On a *Public* network they are **Block** rules, which beat every Allow rule. They come from cancelling or ignoring the prompt.
  - Allowed in the prompt, they open every port to every source.
  - `firewall.ps1 -RemoveAutoRules` replaces them with rules for the controllers' IPs.
- **`VIGEM_ERROR_BUS_NOT_FOUND` while the ViGEmBus service runs** is a broken old install: a service but no bus device. Reinstalling 1.22.0 fixes it.
- **`display_controller_state_error` with `code` 13 at connection is normal.**
  - stadiacast asks for the controller's state every 1.5 s after DTLS until it gets an OK.
  - The controller answers only once its discovery has handed the link to its app. Asks that come before that are answered INTERNAL (13); stadiacast ignores those and asks again.
  - If `display_state ready` and `controller_hardware` follow, nothing is wrong. The console shows it as routine, not as an error.
  - A real problem is no READY at all, which ends in `display_rpc_unanswered` after 5 minutes.
- **`curl.exe -d '{"left":40000}'` fails in PowerShell** with `Expecting property name enclosed in double quotes`. PowerShell strips the inner quotes when it calls a native program. Use `Invoke-RestMethod -Method Post -ContentType 'application/json' -Body '{...}'`, or the scripts here.
- **A browser page cannot drive stadiacast's control endpoints directly**: stadiacast refuses non-GET requests that carry an `Origin` header. Hence the small local server behind the console.
- **Address a controller by IP**, e.g. `/_rumble?controller=192.168.1.201`. The `c0`, `c1` labels follow the order of waking.
- **The battery shows as unknown for minutes, or until a charger goes in.**
  - The controller reports its level (`ControllerToDisplay` #10) only when it moves by 1 %, so not right after connecting, and never at a steady level such as full.
  - The `GetControllerStateResponse` it sends on every connection carries the level too: field 10, a float 0..1 that stadiacast's schema keeps as `fixed32` (`1065353216` is 1.0).
  - The console fills the gap from it. Details in `docs\battery.md`.
- **The flasher writes firmware 316382**, not the 282115 stadiacast was tested on. Both work.

## Layout

| Path | Contents |
|---|---|
| `docs\guide.md` | the full steps (Chinese) |
| `docs\tips.md` | pitfalls (Chinese) |
| `docs\troubleshooting.md` | reading the logs when a controller does not connect (Chinese) |
| `docs\battery.md` | the battery field (Chinese) |
| `docs\background.md` | how stadiacast works, and how it compares with StadiaWireless (Chinese) |
| `stadia-console.cmd` | opens the web console |
| `webui\` | the console: `server.py` (Python standard library only) and the page; its texts are in `webui\static\i18n.js` |
| `scripts\` | start/stop, status, rumble, firewall, router commands, firmware detection |

## Tested with

stadiacast 1.3.0, two GA00827-US controllers on firmware 316382 (flashed back), ViGEmBus 1.22.0, Windows 11 (Chinese locale) with PowerShell 7.5, ImmortalWrt on MT7981 at 5 GHz with WPA2-PSK (CCMP). Headset audio and the microphone were not tried.

## Credits

- [jkfran/stadiacast](https://github.com/jkfran/stadiacast) (MIT) does all the protocol work; this only configures and wraps it.
- [luigimannoni/stadia-controller-flasher](https://github.com/luigimannoni/stadia-controller-flasher) keeps Google's flasher and the Wi-Fi image available.
- stadiacast issues [#5](https://github.com/jkfran/stadiacast/issues/5), [#17](https://github.com/jkfran/stadiacast/issues/17) and [#18](https://github.com/jkfran/stadiacast/issues/18), for the community's experience on Windows and on 316382.
- [ViGEmBus](https://github.com/nefarius/ViGEmBus), the virtual pad driver.

## License

[MIT](LICENSE).
