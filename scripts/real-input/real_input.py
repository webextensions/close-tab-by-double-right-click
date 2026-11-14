"""Send real mouse and keyboard input through GNOME's RemoteDesktop D-Bus API (org.gnome.Mutter.RemoteDesktop).

Imported by the real-input check verify-firefox.py.
Requirements: Linux with GNOME (Wayland or X11) and python3-gi.
"""
import time

import gi

gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib  # noqa: E402

# Linux evdev codes and X11 keysyms
BTN_LEFT, BTN_RIGHT = 272, 273
KEYSYM_TAB, KEYSYM_RETURN, KEYSYM_ESCAPE, KEYSYM_F5 = 0xff09, 0xff0d, 0xff1b, 0xffc2
KEYSYM_SHIFT_L, KEYSYM_CONTROL_L = 0xffe1, 0xffe3

BUS_NAME = 'org.gnome.Mutter.RemoteDesktop'


class Input:
    def __init__(self):
        bus = Gio.bus_get_sync(Gio.BusType.SESSION)
        remote_desktop = Gio.DBusProxy.new_sync(bus, 0, None, BUS_NAME, '/org/gnome/Mutter/RemoteDesktop', BUS_NAME)
        session_path = remote_desktop.call_sync('CreateSession', None, 0, -1, None).unpack()[0]
        self.session = Gio.DBusProxy.new_sync(bus, 0, None, BUS_NAME, session_path, f'{BUS_NAME}.Session')
        self._call('Start', '()')

    def _call(self, method, signature, *args):
        self.session.call_sync(method, GLib.Variant(signature, args), 0, -1, None)

    def move_to(self, x, y):
        # Relative motion only (absolute motion needs a screen-cast stream): park in the top-left corner first
        self._call('NotifyPointerMotionRelative', '(dd)', -20000.0, -20000.0)
        time.sleep(0.1)
        self.move_by(x, y)
        time.sleep(0.1)

    def move_by(self, dx, dy):
        self._call('NotifyPointerMotionRelative', '(dd)', float(dx), float(dy))
        time.sleep(0.1)

    def click(self, button, hold_seconds=0.03):
        self._call('NotifyPointerButton', '(ib)', button, True)
        time.sleep(hold_seconds)
        self._call('NotifyPointerButton', '(ib)', button, False)

    def key(self, keysym, pressed=None):
        states = (True, False) if pressed is None else (pressed,)
        for state in states:
            self._call('NotifyKeyboardKeysym', '(ub)', keysym, state)
            time.sleep(0.02)

    def type_text(self, text):
        for char in text:  # printable ASCII keysyms equal their code points
            self.key(KEYSYM_TAB if char == '\t' else ord(char))

    def stop(self):
        try:
            self._call('Stop', '()')
        except Exception:
            pass

