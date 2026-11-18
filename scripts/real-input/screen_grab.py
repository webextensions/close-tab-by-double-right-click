#!/usr/bin/env python3
"""Save what the primary monitor shows (with the pointer) as a PNG, through GNOME's ScreenCast D-Bus API
(org.gnome.Mutter.ScreenCast) and GStreamer's pipewiresrc.

Shows what a check driven with real_input.py leads to where no test can look: the popup of the toolbar icon, the
options dialog of chrome://extensions, about:addons.
Requirements: Linux with GNOME (tried on Wayland), an unlocked screen, python3-gi, and gst-launch-1.0 with the PipeWire
plugin. The frame holds the whole desktop, so write it outside the repository.

Usage: python3 scripts/real-input/screen_grab.py <file.png>
"""
import subprocess
import sys

import gi

gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib  # noqa: E402

REMOTE_DESKTOP = 'org.gnome.Mutter.RemoteDesktop'
SCREEN_CAST = 'org.gnome.Mutter.ScreenCast'
DISPLAY_CONFIG = 'org.gnome.Mutter.DisplayConfig'

bus = Gio.bus_get_sync(Gio.BusType.SESSION)


def proxy(name, path, interface):
    return Gio.DBusProxy.new_sync(bus, 0, None, name, path, interface)


def call(target, method, signature=None, *args):
    parameters = GLib.Variant(signature, args) if signature else None
    return target.call_sync(method, parameters, 0, -1, None).unpack()


def primary_monitor_connector():
    display_config = proxy(DISPLAY_CONFIG, '/org/gnome/Mutter/DisplayConfig', DISPLAY_CONFIG)
    _serial, _monitors, logical_monitors, _properties = call(display_config, 'GetCurrentState')
    # A logical monitor: (x, y, scale, transform, primary, [(connector, vendor, product, serial)], properties)
    primary = next(logical_monitor for logical_monitor in logical_monitors if logical_monitor[4])
    return primary[5][0][0]


def grab(path):
    # A screen cast belongs to a remote desktop session, which is what starts and stops it
    remote_desktop = proxy(REMOTE_DESKTOP, '/org/gnome/Mutter/RemoteDesktop', REMOTE_DESKTOP)
    session = proxy(REMOTE_DESKTOP, call(remote_desktop, 'CreateSession')[0], f'{REMOTE_DESKTOP}.Session')
    screen_cast = proxy(SCREEN_CAST, '/org/gnome/Mutter/ScreenCast', SCREEN_CAST)
    cast_path = call(screen_cast, 'CreateSession', '(a{sv})', {
        'remote-desktop-session-id': GLib.Variant('s', session.get_cached_property('SessionId').unpack())
    })[0]
    cast = proxy(SCREEN_CAST, cast_path, f'{SCREEN_CAST}.Session')
    stream_path = call(cast, 'RecordMonitor', '(sa{sv})', primary_monitor_connector(), {
        'cursor-mode': GLib.Variant('u', 1)  # the pointer drawn into the frame
    })[0]
    stream = proxy(SCREEN_CAST, stream_path, f'{SCREEN_CAST}.Stream')

    # The stream gets its PipeWire node once the session starts
    loop = GLib.MainLoop()
    node = {}

    def on_signal(_proxy, _sender, signal, parameters):
        if signal == 'PipeWireStreamAdded':
            node['id'] = parameters.unpack()[0]
            loop.quit()

    stream.connect('g-signal', on_signal)
    call(session, 'Start')
    try:
        GLib.timeout_add_seconds(10, loop.quit)
        loop.run()
        if 'id' not in node:
            sys.exit('The screen cast got no PipeWire stream')
        # One frame only: GNOME sends a frame when the screen changes, so a still screen may never send a second one
        subprocess.run(['gst-launch-1.0', '-q', 'pipewiresrc', f'path={node["id"]}', 'num-buffers=1', '!',
                        'videoconvert', '!', 'pngenc', '!', 'filesink', f'location={path}'],
                       check=True, timeout=20)
    finally:
        call(session, 'Stop')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    grab(sys.argv[1])
    print(sys.argv[1])
