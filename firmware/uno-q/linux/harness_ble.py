"""GuideSight harness Bluetooth service for the Arduino UNO Q (Linux side).

The UNO Q's Bluetooth radio is on its Linux processor, not on the microcontroller that runs
the sketch. This service advertises the same BLE service as the ESP32 harness, so the phone
app (mobile/src/lib/harness.ts) works unchanged, and relays messages to and from the sketch
(firmware/uno-q/sketch/sketch.ino) through the Arduino router.

Run it as a normal Linux service (see guidesight-harness.service), not inside an App Lab app:
App Lab apps run in a container that can't reliably reach the Bluetooth stack.
"""

import asyncio
import json
import logging

from arduino.router_bridge import Bridge
from bless import (
    BlessServer,
    GATTAttributePermissions,
    GATTCharacteristicProperties,
)

# Shared BLE contract. Keep in sync with firmware/include/ble_protocol.h and mobile/src/lib/harness.ts.
DEVICE_NAME = "GuideSight-Harness"
SERVICE_UUID = "6e8a0001-4b1c-4f5e-9c2a-7d3f1a2b3c4d"
EVENT_CHAR_UUID = "6e8a0002-4b1c-4f5e-9c2a-7d3f1a2b3c4d"    # harness -> phone (notify)
COMMAND_CHAR_UUID = "6e8a0003-4b1c-4f5e-9c2a-7d3f1a2b3c4d"  # phone -> harness (write)

# Bridge message codes. Keep in sync with sketch/sketch.ino.
EVENT_TYPES = {0: "stop", 1: "pull"}
PATTERNS = {"short": 0, "double": 1, "long": 2}

log = logging.getLogger("guidesight-harness")


async def main() -> None:
    loop = asyncio.get_running_loop()
    bridge = Bridge()
    server = BlessServer(name=DEVICE_NAME, loop=loop)

    def bridge_notify(method: str, *args) -> None:
        try:
            bridge.notify(method, *args)
        except Exception as e:  # router down or sketch not running yet
            log.warning("could not send %s to sketch: %s", method, e)

    # ---- Phone -> harness ---------------------------------------------------
    def read_request(characteristic, **kwargs):
        return characteristic.value

    def write_request(characteristic, value, **kwargs):
        if str(characteristic.uuid).lower() != COMMAND_CHAR_UUID:
            return
        pattern = bytes(value).decode(errors="ignore").strip()
        log.info("cmd: %s", pattern)
        bridge_notify("buzz", PATTERNS.get(pattern, PATTERNS["short"]))

    server.read_request_func = read_request
    server.write_request_func = write_request

    await server.add_new_service(SERVICE_UUID)
    await server.add_new_characteristic(
        SERVICE_UUID,
        EVENT_CHAR_UUID,
        GATTCharacteristicProperties.read | GATTCharacteristicProperties.notify,
        None,
        GATTAttributePermissions.readable,
    )
    await server.add_new_characteristic(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        GATTCharacteristicProperties.write | GATTCharacteristicProperties.write_without_response,
        None,
        GATTAttributePermissions.writeable,
    )

    # ---- Harness -> phone ---------------------------------------------------
    def notify_phone(payload: bytes) -> None:
        server.get_characteristic(EVENT_CHAR_UUID).value = bytearray(payload)
        server.update_value(SERVICE_UUID, EVENT_CHAR_UUID)

    def on_harness_event(kind, accel, ms) -> None:
        # Runs on the bridge's thread, so hand the BLE update to the asyncio loop.
        event_type = EVENT_TYPES.get(int(kind))
        if event_type is None:
            log.warning("unknown event type from sketch: %r", kind)
            return
        payload = json.dumps(
            {"type": event_type, "accel": round(float(accel), 2), "ms": int(ms)},
            separators=(",", ":"),
        )
        log.info(payload)
        loop.call_soon_threadsafe(notify_phone, payload.encode())

    bridge.provide("harness_event", on_harness_event)
    if not await loop.run_in_executor(None, lambda: bridge.connect(timeout=10)):
        log.warning("Arduino router not reachable yet, still trying in the background")

    await server.start()
    log.info("BLE advertising as %s", DEVICE_NAME)

    # Mirror the ESP32's "phone connected" LED by polling the connection state.
    connected = None
    while True:
        try:
            now = bool(await server.is_connected())
        except Exception as e:
            log.warning("can't read BLE connection state, link LED disabled: %s", e)
            break
        if now != connected:
            connected = now
            log.info("phone %s", "connected" if now else "disconnected")
            bridge_notify("set_link", now)
        await asyncio.sleep(1)

    await asyncio.Event().wait()  # keep serving


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
