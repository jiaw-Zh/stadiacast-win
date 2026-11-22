"""List the Stadia Controllers in Bluetooth range and say which firmware mode each is in.

    python find-controllers.py          (with the Python stadiacast was installed with, see below)

With a USB data cable at hand, the community flasher's "Check mode and updates" is simpler
(docs\\guide.md, step 3). This script is the way without a cable, and finds several at once.

Read-only: it scans 20 s, connects once to each controller it finds and reads its services, model,
firmware and battery. Nothing is written to any controller.

- "Wi-Fi setup mode": Wi-Fi firmware, waiting for credentials (blinking orange). Provision it.
- "Bluetooth firmware": the Bluetooth mode Google's 2023 tool installed. stadiacast cannot use it
  until the Wi-Fi firmware is flashed back (docs\\guide.md, step 3).
- A Wi-Fi controller that is not in setup mode does not advertise at all and is not listed.

It needs bleak, which `uv tool install "stadiacast[ble,...]"` installs into the tool's own Python:
    & (Join-Path (uv tool dir) 'stadiacast\\Scripts\\python.exe') find-controllers.py
"""

import asyncio

from bleak import BleakClient, BleakScanner

FAST_PAIR = "0000fe2c-0000-1000-8000-00805f9b34fb"
SETUP_SERVICE = "0000fea0-0000-1000-8000-00805f9b34fb"  # the Wi-Fi firmware's setup service
READS = {
    "model": "00002a24-0000-1000-8000-00805f9b34fb",
    "firmware": "00002a26-0000-1000-8000-00805f9b34fb",
    "battery %": "00002a19-0000-1000-8000-00805f9b34fb",
}


async def main() -> None:
    found: dict[str, tuple] = {}

    def seen(device, adv):
        name = (adv.local_name or device.name or "").lower()
        if "stadia" in name or FAST_PAIR in (adv.service_data or {}):
            found[device.address] = (device, adv)

    print("Scanning 20 s ...")
    async with BleakScanner(detection_callback=seen):
        await asyncio.sleep(20)
    if not found:
        print("No Stadia Controller advertising. A Wi-Fi controller has to be in setup mode (blinking orange).")
        return
    for address, (device, adv) in found.items():
        name = adv.local_name or device.name
        print(f"\n{address}  name={name!r}  rssi={adv.rssi}")
        try:
            async with BleakClient(device, timeout=20.0) as client:
                uuids = [s.uuid for s in client.services]
                if SETUP_SERVICE in uuids:
                    print("  Wi-Fi firmware, in setup mode: provision it with stadiacast-provision")
                else:
                    print("  Bluetooth firmware (no Wi-Fi setup service): flash the Wi-Fi firmware back first")
                for label, uuid in READS.items():
                    try:
                        raw = bytes(await client.read_gatt_char(uuid))
                    except Exception:  # noqa: BLE001 - a characteristic this firmware lacks
                        continue
                    value = raw[0] if label == "battery %" and raw else raw.decode("utf-8", "replace")
                    print(f"  {label}: {value}")
        except Exception as e:  # noqa: BLE001
            print(f"  could not connect: {type(e).__name__}: {e}")


asyncio.run(main())
