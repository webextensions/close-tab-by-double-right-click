#!/usr/bin/env python3
"""Check the extension in a real Firefox window with real mouse and keyboard input.

Playwright cannot load extensions into Firefox, and synthetic page events never open Firefox's native context menu, which
is what breaks double right click on Linux. This script instead:

- launches Firefox through geckodriver and installs the extension as a temporary add-on
- serves the test pages from a local web server; only the check on one of Firefox's restricted domains needs internet
  access, and it is skipped without it
- sends OS-level clicks and key presses through scripts/real-input/real_input.py (GNOME's RemoteDesktop D-Bus API)
- reads the outcome (open tabs, page events) back through WebDriver, and the options page state through the AT-SPI
  accessibility tree (WebDriver cannot read extension pages)

Requirements: Linux with GNOME (Wayland or X11), geckodriver on PATH (the Firefox snap ships one), python3-gi and
gir1.2-atspi-2.0.
It takes over the mouse and keyboard for about three minutes: do not touch them while it runs.

Usage: npm run verify:firefox (generates dist/firefox first), or
python3 scripts/verify-firefox/verify-firefox.py [path/to/extension]

With --sites (npm run verify:firefox:sites), it checks the gesture on the real sites of tests/shared/real-sites.json
instead. That needs internet access and takes about 5 minutes.
"""
import argparse
import base64
import http.server
import io
import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

import gi

gi.require_version('Atspi', '2.0')
from gi.repository import Atspi  # noqa: E402

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

# Real input through GNOME's RemoteDesktop D-Bus API, shared with verify-chrome.js
sys.path.insert(0, os.path.join(REPO_ROOT, 'scripts', 'real-input'))
from real_input import (  # noqa: E402
    BTN_LEFT, BTN_RIGHT, KEYSYM_ALT_L, KEYSYM_CONTROL_L, KEYSYM_DOWN, KEYSYM_ESCAPE, KEYSYM_F5, KEYSYM_RETURN,
    KEYSYM_SHIFT_L, KEYSYM_UP, Input
)

ARGUMENT_PARSER = argparse.ArgumentParser(description='Check the extension in a real Firefox window with real input.')
ARGUMENT_PARSER.add_argument('extension_dir', nargs='?', default=os.path.join(REPO_ROOT, 'dist', 'firefox'),
                             help='the extension folder to load (default: dist/firefox)')
ARGUMENT_PARSER.add_argument('--sites', action='store_true',
                             help='check the gesture on the real sites of tests/shared/real-sites.json instead')
ARGUMENTS = ARGUMENT_PARSER.parse_args()

EXTENSION_DIR = os.path.abspath(ARGUMENTS.extension_dir)

with open(os.path.join(EXTENSION_DIR, 'manifest.json')) as manifest_file:
    ADDON_ID = json.load(manifest_file)['browser_specific_settings']['gecko']['id']
# Fixed internal UUID, so the options page URL is known up front
ADDON_UUID = '0d7c4a5e-3b1f-4c62-9a8e-5f2b7c1d9e40'
OPTIONS_URL = f'moz-extension://{ADDON_UUID}/options.html'
OPTIONS_TITLE = 'Double Right Click - close tab & more'
# The dropdowns of the options page, by their names (there is no Cmd row outside macOS), and their options
MAXIMUM_TIME_DROPDOWN = 'Maximum time between clicks'
GESTURE_DROPDOWNS = {'plain': 'Double right click', 'shift': 'Shift + Double right click',
                     'ctrl': 'Ctrl + Double right click', 'alt': 'Alt + Double right click'}
SAME_AS_DOUBLE_RIGHT_CLICK = 'Same as Double right click'
ACTION_LABELS = ['Do nothing', 'Close the tab', 'Go back', 'Reload the tab', 'Hard reload the tab', 'Open a new tab',
                 'Duplicate the tab', 'Reopen the last closed tab']
DEFAULT_GESTURES = {'plain': 'Close the tab', 'shift': SAME_AS_DOUBLE_RIGHT_CLICK, 'ctrl': SAME_AS_DOUBLE_RIGHT_CLICK,
                    'alt': SAME_AS_DOUBLE_RIGHT_CLICK}
# The Tab presses from the top of the options page to its controls: the four gesture dropdowns, the radio buttons, the
# dropdown of the maximum time, then "Done"
TABS_TO_MAXIMUM_TIME_DROPDOWN = len(GESTURE_DROPDOWNS) + 2
TABS_TO_DONE = len(GESTURE_DROPDOWNS) + 3
# A plain text page on one of the domains where Firefox runs no extension scripts
RESTRICTED_DOMAIN_URL = 'https://support.mozilla.org/robots.txt'
TEST_PAGE = ('<!doctype html><html><head><title>Test page</title></head>'
             '<body style="height:100vh">Test page</body></html>')
# A page which shows its own context menu cancels the browser's one, so nothing swallows parts of a right click there
CANCEL_CONTEXT_MENU_PATH = '/cancel-context-menu'
CANCEL_CONTEXT_MENU_PAGE = TEST_PAGE.replace(
    '</body>', '<script>document.addEventListener("contextmenu", (e) => e.preventDefault());</script></body>')
# A page which uses the "on<event>" properties of the document, which Firefox shares with content scripts
OWN_HANDLERS_PATH = '/own-handlers'
OWN_HANDLERS_PAGE = TEST_PAGE.replace(
    '</body>',
    '<script>window.__ownHandlerCalls = [];'
    'document.onmousedown = () => window.__ownHandlerCalls.push("mousedown");'
    'document.onmouseup = () => window.__ownHandlerCalls.push("mouseup");</script></body>')
# Requests below this path get no answer while the checks run, so a page which uses one of them does not finish loading
STALLED_PATH = '/stalled/'
# A page which stalls inside its <head>, so its document never gets a body
STALLED_HEAD_PATH = '/stalled-head'
STALLED_HEAD_PAGE = TEST_PAGE.replace('</head>', f'<script src="{STALLED_PATH}script.js"></script></head>')
# A page which shows its content while an image keeps it loading
STALLED_IMAGE_PATH = '/stalled-image'
STALLED_IMAGE_PAGE = TEST_PAGE.replace('</body>', f'<img src="{STALLED_PATH}image.png"></body>')
# A page covered by a frame whose own page does not arrive. Such a frame shows an empty placeholder document.
LATE_FRAME_PATH = '/late-frame'
LATE_FRAME_PAGE = TEST_PAGE.replace(
    '</body>',
    f'<iframe src="{STALLED_PATH}frame" style="position:fixed;left:0;top:0;width:100%;height:100%;border:0"></iframe>'
    '</body>')
STALLED_REQUESTS_RELEASED = threading.Event()
# A page whose requests get recorded with their Cache-Control header: a reload which skips the cache asks for "no-cache"
HARD_RELOAD_PATH = '/hard-reload'
HARD_RELOAD_REQUESTS = []
HARD_RELOAD_REQUESTS_LOCK = threading.Lock()
# Bound without listening: the port refuses connections, so a tab which opens it shows one of the browser's error pages
REFUSING_SOCKET = socket.socket()
REFUSING_SOCKET.bind(('127.0.0.1', 0))
ERROR_PAGE_URL = f'http://127.0.0.1:{REFUSING_SOCKET.getsockname()[1]}/'

with socket.socket() as free_port_probe:
    free_port_probe.bind(('127.0.0.1', 0))
    GECKODRIVER_PORT = free_port_probe.getsockname()[1]
BASE_URL = f'http://127.0.0.1:{GECKODRIVER_PORT}'

# The real sites to check with --sites; the Playwright tests and verify-chrome.js read the same list
with open(os.path.join(REPO_ROOT, 'tests', 'shared', 'real-sites.json')) as sites_file:
    REAL_SITES = [site for site in json.load(sites_file) if 'firefox' in site.get('browsers', ['firefox'])]

# A spot inside the page of the full screen window
POINTER = (600, 450)

# Returns the middle of the first element which matches the selector (given as the argument), as far as it is inside
# the viewport, or null when no such element is showing. Also looks inside the shadow trees of the page.
FIND_MIDDLE_OF_ELEMENT = """
const find = (root) => {
    const found = root.querySelector(arguments[0]);
    if (found) {
        return found;
    }
    for (const element of root.querySelectorAll('*')) {
        const foundInShadowTree = element.shadowRoot && find(element.shadowRoot);
        if (foundInShadowTree) {
            return foundInShadowTree;
        }
    }
    return null;
};
const element = find(document);
if (!element) {
    return null;
}
element.scrollIntoView({ block: 'center' });
const box = element.getBoundingClientRect();
if (!box.width || !box.height) {
    return null;
}
return [
    Math.round(Math.min(box.x + box.width / 2, window.innerWidth - 1)),
    Math.round(Math.min(box.y + box.height / 2, window.innerHeight - 1))
];
"""

# Records the mouse events a page receives, to explain a failure
EVENT_LOGGER = """
window.__events = [];
for (const type of ['mousedown', 'mouseup', 'contextmenu']) {
    document.addEventListener(type, (e) => window.__events.push(`${type}:${e.button}`), true);
}
"""


# ---- Test pages ----

class TestPageHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith(STALLED_PATH):
            # Released once the checks are over, when nothing waits for the answer any more
            STALLED_REQUESTS_RELEASED.wait()
            return
        if self.path == HARD_RELOAD_PATH:
            with HARD_RELOAD_REQUESTS_LOCK:
                HARD_RELOAD_REQUESTS.append(self.headers.get('Cache-Control'))
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        pages = {CANCEL_CONTEXT_MENU_PATH: CANCEL_CONTEXT_MENU_PAGE, OWN_HANDLERS_PATH: OWN_HANDLERS_PAGE,
                 STALLED_HEAD_PATH: STALLED_HEAD_PAGE, STALLED_IMAGE_PATH: STALLED_IMAGE_PAGE,
                 LATE_FRAME_PATH: LATE_FRAME_PAGE}
        self.wfile.write(pages.get(self.path, TEST_PAGE).encode())

    def log_message(self, *args):
        pass


# The content script only runs in http(s) pages, so the test pages are served from a local web server
TEST_SERVER = http.server.ThreadingHTTPServer(('127.0.0.1', 0), TestPageHandler)
TEST_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}/'
CANCEL_CONTEXT_MENU_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{CANCEL_CONTEXT_MENU_PATH}'
OWN_HANDLERS_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{OWN_HANDLERS_PATH}'
STALLED_HEAD_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{STALLED_HEAD_PATH}'
STALLED_IMAGE_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{STALLED_IMAGE_PATH}'
LATE_FRAME_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{LATE_FRAME_PATH}'
HARD_RELOAD_URL = f'http://127.0.0.1:{TEST_SERVER.server_port}{HARD_RELOAD_PATH}'


# ---- WebDriver (geckodriver) ----

def webdriver(method, path, body=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE_URL + path, data=data, method=method,
                                     headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read() or b'{}').get('value')
    except urllib.error.HTTPError as err:
        value = json.loads(err.read() or b'{}').get('value', {})
        raise RuntimeError(f'{method} {path}: {value.get("error")}: {value.get("message")}') from None


def wait_for_geckodriver(driver, timeout_seconds=15):
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if driver.poll() is not None:
            raise RuntimeError(f'geckodriver exited with code {driver.returncode}')
        try:
            if webdriver('GET', '/status').get('ready'):
                return
        except (OSError, RuntimeError):
            pass  # not listening yet
        time.sleep(0.2)
    raise RuntimeError(f'geckodriver was not ready within {timeout_seconds} seconds')


class Browser:
    def __init__(self):
        caps = {'capabilities': {'alwaysMatch': {'browserName': 'firefox', 'moz:firefoxOptions': {
            'prefs': {'extensions.webextensions.uuids': json.dumps({ADDON_ID: ADDON_UUID}),
                      # Grants an optional permission without asking, still only on the user's action
                      'extensions.webextOptionalPermissionPrompts': False}}}}}
        response = webdriver('POST', '/session', caps)
        self.session = response['sessionId']
        self.pid = response['capabilities']['moz:processID']

    def cmd(self, method, path, body=None):
        return webdriver(method, f'/session/{self.session}{path}', body)

    def install_extension(self):
        # Sent as an in-memory zip: the Firefox snap cannot read paths such as /tmp
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for root, _, files in os.walk(EXTENSION_DIR):
                for name in files:
                    full_path = os.path.join(root, name)
                    archive.write(full_path, os.path.relpath(full_path, EXTENSION_DIR))
        self.cmd('POST', '/moz/addon/install',
                 {'addon': base64.b64encode(buffer.getvalue()).decode(), 'temporary': True})

    def handles(self):
        return self.cmd('GET', '/window/handles')

    def switch_to(self, handle):
        self.cmd('POST', '/window', {'handle': handle})

    def new_tab(self, url=None):
        handle = self.cmd('POST', '/window/new', {'type': 'tab'})['handle']
        self.switch_to(handle)
        if url:
            self.cmd('POST', '/url', {'url': url})
        return handle

    def run(self, script, args=()):
        return self.cmd('POST', '/execute/sync', {'script': script, 'args': list(args)})

    def quit(self):
        try:
            self.cmd('DELETE', '')
        except Exception:
            pass


# ---- Reading the options page through the AT-SPI accessibility tree ----

def accessible_descendants(node):
    for index in range(node.get_child_count()):
        child = node.get_child_at_index(index)
        if child is not None:
            yield child
            yield from accessible_descendants(child)


def has_state(node, state):
    return node.get_state_set().contains(state)


def read_options_page(pid):
    """Return (document object path, shown state) for the options page, or (None, None) if it is not found.

    The shown state looks like options_state('custom', '1000', shift='Reopen the last closed tab').
    """
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app is None or app.get_process_id() != pid:
            continue
        for node in accessible_descendants(app):
            if node.get_role() == Atspi.Role.DOCUMENT_WEB and node.get_name() == OPTIONS_TITLE:
                checked = [radio.get_name().split(':')[0].split()[0].lower()
                           for radio in accessible_descendants(node)
                           if radio.get_role() == Atspi.Role.RADIO_BUTTON and has_state(radio, Atspi.StateType.CHECKED)]
                dropdowns = read_dropdowns(node)
                # The notice is left out of the accessibility tree while it is hidden
                access_missing = any('needs access to the recently closed tabs' in accessible_text(text)
                                     for text in accessible_descendants(node))
                # Left out of the accessibility tree while it is hidden, like the notice
                reset_shown = any(button.get_role() == Atspi.Role.PUSH_BUTTON and button.get_name() == 'Reset'
                                  for button in accessible_descendants(node))
                return node.path, {'type': checked[0] if checked else None,
                                   'value': dropdowns.get(MAXIMUM_TIME_DROPDOWN),
                                   'gestures': {gesture: dropdowns.get(name)
                                                for gesture, name in GESTURE_DROPDOWNS.items()},
                                   'access_missing': access_missing,
                                   'reset_shown': reset_shown}
    return None, None


def read_dropdowns(document):
    """Return the label of the selected option of each dropdown of `document`, by the name of the dropdown."""
    dropdowns = {}
    for node in accessible_descendants(document):
        if node.get_role() == Atspi.Role.COMBO_BOX:
            selected = [item.get_name() for item in accessible_descendants(node)
                        if item.get_role() == Atspi.Role.MENU_ITEM and has_state(item, Atspi.StateType.SELECTED)]
            dropdowns[node.get_name()] = selected[0] if selected else None
    return dropdowns


def options_state(time_type, time_value, access_missing=False, **gestures):
    """Return the state of the options page with the given choices, and the defaults for the gestures not given."""
    shown_gestures = {gesture: gestures.get(gesture, default) for gesture, default in DEFAULT_GESTURES.items()}
    return {'type': time_type, 'value': time_value, 'gestures': shown_gestures, 'access_missing': access_missing,
            # "Reset" shows while a gesture differs from its default
            'reset_shown': shown_gestures != DEFAULT_GESTURES}


def find_options_page(pid):
    """Return the accessible document of the options page, or None if it is not found."""
    desktop = Atspi.get_desktop(0)
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        if app is None or app.get_process_id() != pid:
            continue
        for node in accessible_descendants(app):
            if node.get_role() == Atspi.Role.DOCUMENT_WEB and node.get_name() == OPTIONS_TITLE:
                return node
    return None


def accessible_text(node):
    text = node.get_text_iface()
    content = Atspi.Text.get_text(text, 0, Atspi.Text.get_character_count(text)) if text else ''
    return f'{node.get_name() or ""} {content}'


def wait_for_text_in_document(document, text, timeout_seconds):
    """Poll until `document` shows `text`; return whether it did."""
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if any(text in accessible_text(node) for node in accessible_descendants(document)):
            return True
        time.sleep(0.2)
    return False


def wait_for_options_page(pid, expected, previous_document=None, timeout_seconds=10):
    """Poll until the options page shows `expected`; with `previous_document`, only a newer document counts."""
    document = state = None
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        document, state = read_options_page(pid)
        if document and document != previous_document and state == expected:
            break
        time.sleep(0.5)
    return document, state


# ---- Checks ----

results = []


def check(name, passed, detail=''):
    results.append((name, passed))
    print(f'{"PASS" if passed else "FAIL"}  {name}{f"  ({detail})" if detail else ""}', flush=True)


def open_test_page(browser, url=TEST_URL):
    handle = browser.new_tab(url)
    browser.run(EVENT_LOGGER)
    time.sleep(1)  # lets the content script read its setting
    return handle


def open_stalled_page(browser, url):
    handle = browser.new_tab()
    # Not through WebDriver's navigation command, which would wait for the page to finish loading
    browser.run(f'window.location.href = {json.dumps(url)};')
    time.sleep(1.5)
    return handle


def focus_page(mouse):
    mouse.move_to(*POINTER)
    mouse.click(BTN_LEFT)  # focuses the window; the extension ignores left clicks
    time.sleep(0.8)


def right_clicks(mouse, gap_seconds):
    mouse.click(BTN_RIGHT)
    time.sleep(gap_seconds)
    mouse.click(BTN_RIGHT)


def close_tab_if_open(browser, mouse, handle, keep):
    if handle in browser.handles():
        mouse.key(KEYSYM_ESCAPE)
        browser.switch_to(handle)
        browser.cmd('DELETE', '/window')
    browser.switch_to(keep)


def check_clicks(browser, mouse, keep):
    target = open_test_page(browser)
    focus_page(mouse)
    if not browser.run('return window.__events;'):
        raise RuntimeError('The test click did not reach the page: the pointer is not over the Firefox content area')

    browser.run('window.__events = [];')
    mouse.click(BTN_RIGHT)
    time.sleep(1.2)
    check('single right click keeps the tab open', target in browser.handles(),
          'events: ' + ', '.join(browser.run('return window.__events;') or []))
    mouse.key(KEYSYM_ESCAPE)
    time.sleep(1)

    browser.run('window.__events = [];')
    right_clicks(mouse, 0.15)
    time.sleep(1.5)
    closed = target not in browser.handles()
    check('double right click (mouse not moved) closes the tab', closed,
          '' if closed else 'events: ' + ', '.join(browser.run('return window.__events;') or []))
    close_tab_if_open(browser, mouse, target, keep)

    target = open_test_page(browser)
    right_clicks(mouse, 0.8)
    time.sleep(1.5)
    check('right clicks 800 ms apart keep the tab open (default 500 ms)', target in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def check_held_clicks(browser, mouse, keep):
    # Both the "mousedown" and the "mouseup" of a right click reach a page which cancels the context menu, and a real
    # click keeps the button down for a while
    target = open_test_page(browser, CANCEL_CONTEXT_MENU_URL)
    focus_page(mouse)

    browser.run('window.__events = [];')
    mouse.click(BTN_RIGHT, 0.12)
    time.sleep(1.2)
    still_open = target in browser.handles()
    check('single right click held for 120 ms on a page which cancels the context menu keeps the tab open', still_open,
          'events: ' + ', '.join(browser.run('return window.__events;') or []) if still_open else '')
    if not still_open:
        browser.switch_to(keep)
        target = open_test_page(browser, CANCEL_CONTEXT_MENU_URL)

    mouse.click(BTN_RIGHT, 0.12)
    time.sleep(0.15)
    mouse.click(BTN_RIGHT, 0.12)
    time.sleep(1.5)
    check('double right click on a page which cancels the context menu closes the tab',
          target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def right_clicks_with_key(mouse, keysym):
    mouse.key(keysym, True)
    try:
        time.sleep(0.1)
        right_clicks(mouse, 0.15)
        time.sleep(0.3)
    finally:
        mouse.key(keysym, False)
    time.sleep(1.2)


def shift_right_clicks(mouse):
    right_clicks_with_key(mouse, KEYSYM_SHIFT_L)


def check_key_clicks(browser, mouse, keep):
    # On Shift + right click, Firefox opens its context menu without sending "contextmenu" to the page
    for name, keysym in (('Shift', KEYSYM_SHIFT_L), ('Ctrl', KEYSYM_CONTROL_L), ('Alt', KEYSYM_ALT_L)):
        target = open_test_page(browser)
        focus_page(mouse)
        right_clicks_with_key(mouse, keysym)
        check(f'{name} + double right click closes the tab while nothing is set for it',
              target not in browser.handles())
        close_tab_if_open(browser, mouse, target, keep)


def check_own_handlers(browser, mouse, keep):
    # The content script must neither replace the page's own handlers nor depend on that property staying untouched
    target = open_test_page(browser, OWN_HANDLERS_URL)
    focus_page(mouse)
    calls = browser.run('return window.__ownHandlerCalls;')
    check("the page's own document.onmousedown and document.onmouseup handlers keep working",
          calls == ['mousedown', 'mouseup'], 'calls: ' + ', '.join(calls))

    browser.run('document.onmousedown = null; document.onmouseup = null;')
    right_clicks(mouse, 0.15)
    time.sleep(1.5)
    check('double right click closes the tab after the page reset its own handlers', target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def check_loading_pages(browser, mouse, keep):
    # A slow page can take minutes to load, and the double right click has to work in the meantime
    pages = (('a page which shows its content while it keeps loading', STALLED_IMAGE_URL, ['interactive', True]),
             ('a page which is stalled in its <head>', STALLED_HEAD_URL, ['loading', False]),
             # The clicks go to the frame, where the content script of the page around it listens
             ('a frame which still waits for its own page', LATE_FRAME_URL, ['interactive', True]))
    for name, url, expected_state in pages:
        target = open_stalled_page(browser, url)
        focus_page(mouse)
        state = browser.run('return [document.URL, document.readyState, !!document.body];')
        if state != [url] + expected_state:
            raise RuntimeError(f'Expected {name}, got {json.dumps(state)}')

        mouse.click(BTN_RIGHT)
        time.sleep(1.2)
        still_open = target in browser.handles()
        check(f'single right click on {name} keeps the tab open', still_open)
        if still_open:
            mouse.key(KEYSYM_ESCAPE)
            time.sleep(1)
        else:
            browser.switch_to(keep)
            target = open_stalled_page(browser, url)
            focus_page(mouse)

        right_clicks(mouse, 0.15)
        time.sleep(1.5)
        check(f'double right click on {name} closes the tab', target not in browser.handles())
        close_tab_if_open(browser, mouse, target, keep)


def check_rewritten_page(browser, mouse, keep):
    # document.open() erases every event listener of the document and its window; the content script has to notice
    # that and attach its listeners again
    target = open_test_page(browser)
    focus_page(mouse)
    browser.run(f'document.open(); document.write({json.dumps(TEST_PAGE)}); document.close();')
    time.sleep(0.5)
    right_clicks(mouse, 0.15)
    time.sleep(1.5)
    check('double right click closes the tab after the page rewrote itself', target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def choose_close_tab_entry(mouse):
    mouse.click(BTN_RIGHT)
    time.sleep(0.8)
    # Selects the first menu item starting with "C", which is "Close tab" on the pages checked here
    mouse.type_text('c')
    time.sleep(0.3)
    mouse.key(KEYSYM_RETURN)
    time.sleep(1.5)


def check_context_menu_entry(browser, mouse, keep):
    # A new tab starts on about:blank, where the extension adds a "Close tab" context-menu entry
    blank = browser.new_tab()
    time.sleep(2)
    choose_close_tab_entry(mouse)
    check('"Close tab" context-menu entry on about:blank closes the tab', blank not in browser.handles())
    close_tab_if_open(browser, mouse, blank, keep)


def check_error_page(browser, mouse, keep):
    # The content script cannot run on the browser's error pages either, so they get the entry as well
    target = browser.new_tab()
    try:
        browser.cmd('POST', '/url', {'url': ERROR_PAGE_URL})
    except RuntimeError:
        pass  # WebDriver reports reaching an error page as a failed navigation
    time.sleep(2)
    choose_close_tab_entry(mouse)
    check('"Close tab" context-menu entry on a browser error page closes the tab', target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def is_online():
    try:
        with urllib.request.urlopen(RESTRICTED_DOMAIN_URL, timeout=5):
            return True
    except urllib.error.HTTPError:
        return True  # the server answered
    except OSError:
        return False


def check_restricted_domain(browser, mouse, keep):
    # The content script cannot run on Firefox's restricted domains, so they get the "Close tab" context-menu entry
    name = '"Close tab" context-menu entry on a restricted domain closes the tab'
    if not is_online():
        print(f'SKIP  {name}  (no internet access)', flush=True)
        return
    target = browser.new_tab(RESTRICTED_DOMAIN_URL)
    time.sleep(3)
    focus_page(mouse)
    choose_close_tab_entry(mouse)
    check(name, target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def open_real_site(browser, url):
    """Opens the URL in a new tab. Returns the tab and, if the site could not be reached in two attempts, the reason."""
    handle = browser.new_tab()
    state = None
    for _ in range(2):
        # Not through WebDriver's navigation command, which would wait for the page to finish loading
        browser.run(f'window.location.href = {json.dumps(url)};')
        deadline = time.time() + 30
        while time.time() < deadline:
            time.sleep(0.5)
            try:
                # An error page of the browser keeps the URL of the site, but not as its "documentURI"
                state = browser.run('return [document.documentURI, document.readyState];')
            except RuntimeError:
                continue  # the document is being replaced
            if state and state[0] != 'about:blank' and state[1] != 'loading':
                break
        if state and not state[0].startswith('about:') and state[1] != 'loading':
            # Lets the page settle, and the content script read its setting
            time.sleep(3)
            return handle, None
    return handle, f'Could not open {url}: {json.dumps(state)}'


def check_real_site(browser, mouse, keep, site):
    name = site['name']
    if site.get('kind') == 'menu-entry':
        # The content script cannot run or gets no clicks there, so the site gets the "Close tab" context-menu entry
        target = browser.new_tab(site['url'])
        time.sleep(3)
        mouse.move_to(*POINTER)
        choose_close_tab_entry(mouse)
        check(f'{name}: "Close tab" context-menu entry closes the tab', target not in browser.handles())
        close_tab_if_open(browser, mouse, target, keep)
        return

    target, failure = open_real_site(browser, site['url'])
    if failure:
        print(f'SKIP  {name}: not checked  ({failure})', flush=True)
        close_tab_if_open(browser, mouse, target, keep)
        return
    served_page = browser.run('return document.URL;')
    selector = site.get('target') or site.get('frame')
    # The window is full screen, so a position inside the page is the same position on the screen
    position = browser.run(FIND_MIDDLE_OF_ELEMENT, [selector]) if selector else None
    detail = f'{served_page}, "{selector}" is not showing' if selector and not position else served_page

    mouse.move_to(*(position or POINTER))
    mouse.click(BTN_RIGHT)
    time.sleep(1.2)
    still_open = target in browser.handles()
    check(f'{name}: single right click keeps the tab open', still_open, detail)
    if still_open:
        mouse.key(KEYSYM_ESCAPE)
        time.sleep(1)
        right_clicks(mouse, 0.15)
        time.sleep(1.5)
        check(f'{name}: double right click closes the tab', target not in browser.handles(), detail)
    close_tab_if_open(browser, mouse, target, keep)


def check_real_sites(browser, mouse, keep):
    # The gesture on real sites. Whatever a site serves gets checked (a bot check, a login page and a consent screen
    # are pages too), and each result tells which page that was.
    # The tab which stays open gets the left click which focuses the window: on a real site it could follow a link.
    browser.switch_to(keep)
    focus_page(mouse)

    for site in REAL_SITES:
        try:
            check_real_site(browser, mouse, keep, site)
        except Exception as err:
            # The next sites still get checked
            check(f'{site["name"]}: could not be checked', False, str(err))
            mouse.key(KEYSYM_ESCAPE)
            for handle in browser.handles():
                if handle != keep:
                    browser.switch_to(handle)
                    browser.cmd('DELETE', '/window')
            browser.switch_to(keep)


def open_options_page(browser, mouse, first_url=None):
    # WebDriver refuses to navigate to moz-extension:// URLs, so type the URL into the address bar instead
    handle = browser.new_tab(first_url)
    time.sleep(1)
    mouse.key(KEYSYM_CONTROL_L, True)
    mouse.type_text('l')
    mouse.key(KEYSYM_CONTROL_L, False)
    time.sleep(0.5)
    mouse.type_text(OPTIONS_URL)
    mouse.key(KEYSYM_RETURN)
    time.sleep(2)
    return handle


def check_options_page(browser, mouse, keep):
    # WebDriver cannot read or script extension pages ("privileged scope"), so drive the page with the keyboard, read
    # it through the accessibility tree, and check the effect: the content script must pick up the saved custom value
    open_options_page(browser, mouse)
    default_state = options_state('default', '500')
    _, state = wait_for_options_page(browser.pid, default_state)
    check('options page starts on "Default" (500 ms)', state == default_state, json.dumps(state))

    mouse.type_text('\t' * TABS_TO_MAXIMUM_TIME_DROPDOWN)
    mouse.type_text('1000')  # type-ahead selects the "1000" option and fires "change"
    custom_state = options_state('custom', '1000')
    document_before_reload, state = wait_for_options_page(browser.pid, custom_state)
    check('choosing 1000 in the dropdown selects "Custom"', state == custom_state, json.dumps(state))

    mouse.key(KEYSYM_F5)
    document, state = wait_for_options_page(browser.pid, custom_state, previous_document=document_before_reload)
    check('options page still shows custom 1000 ms after a reload',
          document != document_before_reload and state == custom_state, json.dumps(state))

    mouse.key(KEYSYM_CONTROL_L, True)
    mouse.type_text('w')  # close the options tab
    mouse.key(KEYSYM_CONTROL_L, False)
    time.sleep(1)
    browser.switch_to(keep)

    target = open_test_page(browser)
    mouse.move_to(600, 450)
    right_clicks(mouse, 0.8)
    time.sleep(1.5)
    check('with custom 1000 ms, right clicks 800 ms apart close the tab', target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def check_done_button(browser, mouse, keep):
    # Firefox lets a page close a tab which shows nothing before it, so the tab shows a page first. Then the options page
    # stays open on "Done", as it does inside about:addons, and shows the note. Follows check_options_page, which
    # leaves the custom 1000 ms
    options_tab = open_options_page(browser, mouse, TEST_URL)
    unchanged_state = options_state('custom', '1000')
    wait_for_options_page(browser.pid, unchanged_state)
    document = find_options_page(browser.pid)
    mouse.type_text('\t' * TABS_TO_DONE)
    mouse.type_text(' ')
    # The note shows after 100 ms, for 2.5 seconds
    shown = bool(document) and wait_for_text_in_document(document, 'Your change would apply next time onwards', 2.5)
    # Changing the maximum time shows the same note, so the state must be unchanged
    _, state = read_options_page(browser.pid)
    check('"Done" on the options page which stays open shows the note', shown and state == unchanged_state,
          f'note shown: {shown}, state: {json.dumps(state)}')
    # Had "Done" closed the options tab, Ctrl+W would close the last tab, and with it the browser
    if options_tab in browser.handles():
        mouse.key(KEYSYM_CONTROL_L, True)
        mouse.type_text('w')  # close the options tab
        mouse.key(KEYSYM_CONTROL_L, False)
        time.sleep(1)
    browser.switch_to(keep)


def choose_gesture_action(browser, mouse, keep, gesture, label, expected):
    """Choose what a gesture ('shift', ...) does on the options page, and return the state it shows then.

    Picks the option from the opened dropdown, as a user does: the page asks for the permission to reopen closed tabs
    on that change, which Firefox only allows on the user's action. `expected` is the state the page should show.
    Follows check_options_page, which leaves the custom 1000 ms.
    """
    open_options_page(browser, mouse)
    deadline = time.time() + 10
    _, state = read_options_page(browser.pid)
    while not state and time.time() < deadline:
        time.sleep(0.5)
        _, state = read_options_page(browser.pid)
    if not state:
        raise RuntimeError('The options page could not be read')
    current = state['gestures'][gesture]
    labels = ACTION_LABELS if gesture == 'plain' else [SAME_AS_DOUBLE_RIGHT_CLICK, *ACTION_LABELS]
    steps = labels.index(label) - labels.index(current)
    # "Reset" comes first while it shows
    mouse.type_text('\t' * (list(GESTURE_DROPDOWNS).index(gesture) + 1 + (1 if state['reset_shown'] else 0)))
    # Alt+Down opens the dropdown, the arrow keys move through its options and Enter takes one
    mouse.key(KEYSYM_ALT_L, True)
    mouse.key(KEYSYM_DOWN)
    mouse.key(KEYSYM_ALT_L, False)
    time.sleep(0.5)
    for _ in range(abs(steps)):
        mouse.key(KEYSYM_DOWN if steps > 0 else KEYSYM_UP)
        time.sleep(0.1)
    mouse.key(KEYSYM_RETURN)
    _, state = wait_for_options_page(browser.pid, expected)
    mouse.key(KEYSYM_CONTROL_L, True)
    mouse.type_text('w')  # close the options tab
    mouse.key(KEYSYM_CONTROL_L, False)
    time.sleep(1)
    browser.switch_to(keep)
    return state


def close_with_gesture(browser, mouse, keep, url):
    handle = open_test_page(browser, url)
    focus_page(mouse)
    right_clicks(mouse, 0.15)
    time.sleep(1.5)
    if handle in browser.handles():
        raise RuntimeError(f'Double right click did not close {url}')
    browser.switch_to(keep)


def reopened_tab_urls(browser, mouse, keep, handles_before):
    """Return the URLs of the tabs which showed up since `handles_before`, and close those tabs."""
    mouse.key(KEYSYM_ESCAPE)  # the context menu which the first click opened
    urls = []
    for handle in browser.handles():
        if handle not in handles_before:
            browser.switch_to(handle)
            urls.append(browser.cmd('GET', '/url'))
            browser.cmd('DELETE', '/window')
    browser.switch_to(keep)
    return urls


def check_reopen_closed_tab(browser, mouse, keep):
    # Each closed tab gets its own URL, since the earlier checks closed many tabs with the same one
    expected = options_state('custom', '1000', shift='Reopen the last closed tab')
    state = choose_gesture_action(browser, mouse, keep, 'shift', 'Reopen the last closed tab', expected)
    check('choosing to reopen the last closed tab for Shift, from the opened dropdown, gets the permission',
          state == expected, json.dumps(state))

    close_with_gesture(browser, mouse, keep, f'{TEST_URL}?closed-first')
    target = open_test_page(browser)
    focus_page(mouse)
    handles_before = browser.handles()
    shift_right_clicks(mouse)
    still_open = target in browser.handles()
    urls = reopened_tab_urls(browser, mouse, keep, handles_before)
    check('Shift + double right click reopens the last closed tab and keeps the tab open',
          still_open and urls == [f'{TEST_URL}?closed-first'], json.dumps(urls))
    close_tab_if_open(browser, mouse, target, keep)

    close_with_gesture(browser, mouse, keep, f'{TEST_URL}?closed-second')
    close_with_gesture(browser, mouse, keep, f'{TEST_URL}?closed-third')
    target = open_test_page(browser)
    focus_page(mouse)
    handles_before = browser.handles()
    shift_right_clicks(mouse)
    urls = reopened_tab_urls(browser, mouse, keep, handles_before)
    check('after closing two tabs, Shift + double right click reopens only the last one',
          urls == [f'{TEST_URL}?closed-third'], json.dumps(urls))
    close_tab_if_open(browser, mouse, target, keep)

    expected = options_state('custom', '1000')
    state = choose_gesture_action(browser, mouse, keep, 'shift', SAME_AS_DOUBLE_RIGHT_CLICK, expected)
    check('setting Shift back to the double right click', state == expected, json.dumps(state))
    target = open_test_page(browser)
    focus_page(mouse)
    shift_right_clicks(mouse)
    check('then Shift + double right click closes the tab', target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def check_key_actions(browser, mouse, keep):
    # Follows check_reopen_closed_tab, which leaves the gestures at their defaults
    expected = options_state('custom', '1000', ctrl='Do nothing')
    state = choose_gesture_action(browser, mouse, keep, 'ctrl', 'Do nothing', expected)
    check('setting Ctrl to do nothing', state == expected, json.dumps(state))
    target = open_test_page(browser)
    focus_page(mouse)
    right_clicks_with_key(mouse, KEYSYM_CONTROL_L)
    check('Ctrl + double right click set to do nothing keeps the tab open', target in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)

    expected = options_state('custom', '1000', ctrl='Hard reload the tab')
    state = choose_gesture_action(browser, mouse, keep, 'ctrl', 'Hard reload the tab', expected)
    check('setting Ctrl to hard reload the tab', state == expected, json.dumps(state))
    with HARD_RELOAD_REQUESTS_LOCK:
        HARD_RELOAD_REQUESTS.clear()
    target = open_test_page(browser, HARD_RELOAD_URL)
    focus_page(mouse)
    right_clicks_with_key(mouse, KEYSYM_CONTROL_L)
    deadline = time.time() + 5
    while True:
        with HARD_RELOAD_REQUESTS_LOCK:
            requests = list(HARD_RELOAD_REQUESTS)
        if len(requests) >= 2 or time.time() > deadline:
            break
        time.sleep(0.2)
    check('Ctrl + double right click set to hard reload the tab reloads it without the cache',
          target in browser.handles() and len(requests) == 2 and requests[1] == 'no-cache', json.dumps(requests))
    close_tab_if_open(browser, mouse, target, keep)

    expected = options_state('custom', '1000', ctrl='Hard reload the tab', alt='Duplicate the tab')
    state = choose_gesture_action(browser, mouse, keep, 'alt', 'Duplicate the tab', expected)
    check('setting Alt to duplicate the tab', state == expected, json.dumps(state))
    target = open_test_page(browser)
    focus_page(mouse)
    handles_before = browser.handles()
    right_clicks_with_key(mouse, KEYSYM_ALT_L)
    still_open = target in browser.handles()
    urls = reopened_tab_urls(browser, mouse, keep, handles_before)
    check('Alt + double right click set to duplicate the tab duplicates it and keeps it open',
          still_open and urls == [TEST_URL], json.dumps(urls))
    close_tab_if_open(browser, mouse, target, keep)

    open_options_page(browser, mouse)
    wait_for_options_page(browser.pid, expected)
    mouse.type_text('\t ')  # "Reset", the first control while it shows
    expected = options_state('custom', '1000')
    _, state = wait_for_options_page(browser.pid, expected)
    check('"Reset" puts the gestures back to their defaults', state == expected, json.dumps(state))
    mouse.key(KEYSYM_CONTROL_L, True)
    mouse.type_text('w')  # close the options tab
    mouse.key(KEYSYM_CONTROL_L, False)
    time.sleep(1)
    browser.switch_to(keep)


def main():
    # Firefox only exposes its accessibility tree when asked to; NO_AT_BRIDGE (set in some desktop sessions) turns it off
    driver_env = {name: value for name, value in os.environ.items() if name != 'NO_AT_BRIDGE'}
    driver_env['GNOME_ACCESSIBILITY'] = '1'
    driver = subprocess.Popen(['geckodriver', '--port', str(GECKODRIVER_PORT)], env=driver_env,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    browser = mouse = None
    threading.Thread(target=TEST_SERVER.serve_forever, daemon=True).start()
    try:
        wait_for_geckodriver(driver)
        browser = Browser()
        browser.install_extension()
        # Keeps the window open when a test tab closes
        browser.cmd('POST', '/url', {'url': TEST_URL})
        keep = browser.handles()[0]
        browser.cmd('POST', '/window/fullscreen', {})
        time.sleep(1.5)
        mouse = Input()

        steps = (check_real_sites,) if ARGUMENTS.sites else (
            check_clicks, check_held_clicks, check_key_clicks, check_own_handlers, check_loading_pages,
            check_rewritten_page, check_context_menu_entry, check_error_page, check_restricted_domain,
            check_options_page, check_done_button, check_reopen_closed_tab, check_key_actions)
        for step in steps:
            try:
                step(browser, mouse, keep)
            except Exception as err:
                check(step.__name__, False, str(err))
                browser.switch_to(keep)
    finally:
        STALLED_REQUESTS_RELEASED.set()
        if mouse:
            mouse.stop()
        if browser:
            browser.quit()
        driver.terminate()

    failed = [name for name, passed in results if not passed]
    print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
