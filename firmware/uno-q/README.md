# GuideSight harness on the Arduino UNO Q

Alternative to the ESP32 firmware in `firmware/src/`. The phone app doesn't change: the UNO Q
advertises the same BLE service (`GuideSight-Harness`, same UUIDs, same JSON events and
`short`/`double`/`long` commands).

The UNO Q has two processors, and Bluetooth is on the Linux one, so the harness is split in two:

```
 MPU6050 ─I2C─▶ STM32 sketch ──Router Bridge──▶ Linux: harness_ble.py ──BLE──▶ phone app
 motor ◀───────┘ (stop/pull detection, buzz)     (BLE GATT server)       ◀── buzz commands
```

| Part | File | Runs on |
|---|---|---|
| Motion detection, motor, LED | `sketch/sketch.ino` | STM32U585 microcontroller |
| Bluetooth link to the phone | `linux/harness_ble.py` | Debian Linux (Qualcomm processor) |

## Wiring

The UNO Q's header pins are **3.3 V**. That suits MPU6050 breakouts, but don't feed 5 V into any pin.

| From | To UNO Q |
|---|---|
| MPU6050 VCC | 3.3V |
| MPU6050 GND | GND |
| MPU6050 SDA | SDA (header pin next to AREF) |
| MPU6050 SCL | SCL |
| Motor driver input (transistor/driver board) | D9 |

The sketch uses `Wire`, the header I2C pins. If you plug the sensor into the Qwiic connector
instead, change `Wire` to `Wire1` in the sketch.

## 1. Flash the sketch

In **Arduino App Lab**, create a new app and replace its `sketch/sketch.ino` with
`sketch/sketch.ino` from this folder. The sketch needs no extra libraries (it reads the
MPU6050 registers directly). Leave the app's `python/main.py` as the default. The BLE part
runs separately in step 2.

Run the app. The motor gives one short buzz when the sketch starts. Fast LED blinking means
the MPU6050 wasn't found, so check the wiring.

## 2. Install the Bluetooth service on the Linux side

From a shell on the UNO Q (SSH, or the terminal in App Lab):

```bash
sudo mkdir -p /opt/guidesight-harness
sudo cp harness_ble.py requirements.txt /opt/guidesight-harness/
cd /opt/guidesight-harness
sudo python3 -m venv .venv
sudo .venv/bin/pip install -r requirements.txt

# Try it in the foreground first
sudo .venv/bin/python harness_ble.py

# Then install it to start on boot
sudo cp guidesight-harness.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now guidesight-harness
journalctl -u guidesight-harness -f   # live logs: events, commands, phone connect/disconnect
```

It runs as a system service, not inside App Lab, because App Lab apps run in a container that
can't reliably reach the Bluetooth stack.

## Troubleshooting

- **Phone can't find the harness:** run `bluetoothctl show` and check `Powered: yes`. If it says
  no, run `bluetoothctl power on`.
- **"could not send buzz to sketch":** the sketch isn't running, or the router is down. Check
  `systemctl status arduino-router`.
- **No events in the logs:** shake the handle hard. A pull should show up as `{"type":"pull",...}`.
  Stops need the sensor to move like walking first, then stay still for 0.7 s.
