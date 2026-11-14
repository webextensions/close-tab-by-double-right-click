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
It takes over the mouse and keyboard for about a minute: do not touch them while it runs.

Usage: npm run verify:firefox (generates dist/firefox first), or
python3 scripts/verify-firefox/verify-firefox.py [path/to/extension]
"""
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
    BTN_LEFT, BTN_RIGHT, KEYSYM_CONTROL_L, KEYSYM_ESCAPE, KEYSYM_F5, KEYSYM_RETURN, KEYSYM_SHIFT_L, Input
)

EXTENSION_DIR = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(REPO_ROOT, 'dist', 'firefox')

with open(os.path.join(EXTENSION_DIR, 'manifest.json')) as manifest_file:
    ADDON_ID = json.load(manifest_file)['browser_specific_settings']['gecko']['id']
# Fixed internal UUID, so the options page URL is known up front
ADDON_UUID = '0d7c4a5e-3b1f-4c62-9a8e-5f2b7c1d9e40'
OPTIONS_URL = f'moz-extension://{ADDON_UUID}/options.html'
OPTIONS_TITLE = 'Close Tab by Double Right Click'
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
STALLED_REQUESTS_RELEASED = threading.Event()

with socket.socket() as free_port_probe:
    free_port_probe.bind(('127.0.0.1', 0))
    GECKODRIVER_PORT = free_port_probe.getsockname()[1]
BASE_URL = f'http://127.0.0.1:{GECKODRIVER_PORT}'

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
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        pages = {CANCEL_CONTEXT_MENU_PATH: CANCEL_CONTEXT_MENU_PAGE, OWN_HANDLERS_PATH: OWN_HANDLERS_PAGE,
                 STALLED_HEAD_PATH: STALLED_HEAD_PAGE, STALLED_IMAGE_PATH: STALLED_IMAGE_PAGE}
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
            'prefs': {'extensions.webextensions.uuids': json.dumps({ADDON_ID: ADDON_UUID})}}}}}
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

    def run(self, script):
        return self.cmd('POST', '/execute/sync', {'script': script, 'args': []})

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

    The shown state looks like {'type': 'custom', 'value': '1000'}.
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
                selected = [item.get_name() for item in accessible_descendants(node)
                            if item.get_role() == Atspi.Role.MENU_ITEM and has_state(item, Atspi.StateType.SELECTED)]
                return node.path, {'type': checked[0] if checked else None,
                                   'value': selected[0] if selected else None}
    return None, None


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
    mouse.move_to(600, 450)
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


def check_shift_clicks(browser, mouse, keep):
    # On Shift + right click, Firefox opens its context menu without sending "contextmenu" to the page
    target = open_test_page(browser)
    focus_page(mouse)
    mouse.key(KEYSYM_SHIFT_L, True)
    try:
        time.sleep(0.1)
        right_clicks(mouse, 0.15)
        time.sleep(0.3)
    finally:
        mouse.key(KEYSYM_SHIFT_L, False)
    time.sleep(1.2)
    check('Shift + double right click closes the tab', target not in browser.handles())
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
             ('a page which is stalled in its <head>', STALLED_HEAD_URL, ['loading', False]))
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
    # Selects the first menu item starting with "C", which is "Close Tab" on the pages checked here
    mouse.type_text('c')
    time.sleep(0.3)
    mouse.key(KEYSYM_RETURN)
    time.sleep(1.5)


def check_context_menu_entry(browser, mouse, keep):
    # A new tab starts on about:blank, where the extension adds a "Close Tab" context-menu entry
    blank = browser.new_tab()
    time.sleep(2)
    choose_close_tab_entry(mouse)
    check('"Close Tab" context-menu entry on about:blank closes the tab', blank not in browser.handles())
    close_tab_if_open(browser, mouse, blank, keep)


def is_online():
    try:
        with urllib.request.urlopen(RESTRICTED_DOMAIN_URL, timeout=5):
            return True
    except urllib.error.HTTPError:
        return True  # the server answered
    except OSError:
        return False


def check_restricted_domain(browser, mouse, keep):
    # The content script cannot run on Firefox's restricted domains, so they get the "Close Tab" context-menu entry
    name = '"Close Tab" context-menu entry on a restricted domain closes the tab'
    if not is_online():
        print(f'SKIP  {name}  (no internet access)', flush=True)
        return
    target = browser.new_tab(RESTRICTED_DOMAIN_URL)
    time.sleep(3)
    focus_page(mouse)
    choose_close_tab_entry(mouse)
    check(name, target not in browser.handles())
    close_tab_if_open(browser, mouse, target, keep)


def open_options_page(browser, mouse):
    # WebDriver refuses to navigate to moz-extension:// URLs, so type the URL into the address bar instead
    browser.new_tab()
    time.sleep(1)
    mouse.key(KEYSYM_CONTROL_L, True)
    mouse.type_text('l')
    mouse.key(KEYSYM_CONTROL_L, False)
    time.sleep(0.5)
    mouse.type_text(OPTIONS_URL)
    mouse.key(KEYSYM_RETURN)
    time.sleep(2)


def check_options_page(browser, mouse, keep):
    # WebDriver cannot read or script extension pages ("privileged scope"), so drive the page with the keyboard, read
    # it through the accessibility tree, and check the effect: the content script must pick up the saved custom value
    open_options_page(browser, mouse)
    default_state = {'type': 'default', 'value': '500'}
    _, state = wait_for_options_page(browser.pid, default_state)
    check('options page starts on "Default" (500 ms)', state == default_state, json.dumps(state))

    mouse.type_text('\t\t')  # "Default" radio, then the dropdown
    mouse.type_text('1000')  # type-ahead selects the "1000" option and fires "change"
    custom_state = {'type': 'custom', 'value': '1000'}
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

        steps = (check_clicks, check_held_clicks, check_shift_clicks, check_own_handlers, check_loading_pages,
                 check_rewritten_page, check_context_menu_entry, check_restricted_domain, check_options_page)
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
