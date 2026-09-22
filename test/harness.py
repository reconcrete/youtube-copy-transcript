"""Minimal Chrome DevTools Protocol harness: launches a Chromium with the extension loaded."""
import asyncio, base64, json, os, subprocess, tempfile, time, urllib.request
import websockets

EXT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("PORT", "9333"))
OUT = os.environ.get("OUT") or tempfile.mkdtemp(prefix="yct-test-")

class CDP:
    def __init__(self, ws): self.ws, self.n, self.events = ws, 0, []
    async def send(self, method, params=None, session=None):
        self.n += 1
        msg = {"id": self.n, "method": method, "params": params or {}}
        if session: msg["sessionId"] = session
        await self.ws.send(json.dumps(msg))
        while True:
            raw = json.loads(await self.ws.recv())
            if raw.get("id") == self.n:
                if "error" in raw: raise RuntimeError(f"{method}: {raw['error']}")
                return raw.get("result", {})
            if "method" in raw: self.events.append(raw)

class Page:
    def __init__(self, cdp, session): self.cdp, self.s = cdp, session
    async def ev(self, expr, await_promise=False):
        r = await self.cdp.send("Runtime.evaluate", {"expression": expr, "awaitPromise": await_promise, "returnByValue": True}, session=self.s)
        if "exceptionDetails" in r:
            d = r["exceptionDetails"]
            raise RuntimeError(d.get("text", "") + " " + str(d.get("exception", {}).get("description", "")))
        return r["result"].get("value")
    async def wait_js(self, expr, timeout=30):
        for _ in range(int(timeout * 2)):
            try:
                v = await self.ev(expr)
                if v: return v
            except Exception:
                pass
            await asyncio.sleep(0.5)
        raise RuntimeError("timeout waiting for: " + expr)
    async def shot(self, name):
        d = await self.cdp.send("Page.captureScreenshot", {"format": "png"}, session=self.s)
        open(os.path.join(OUT, name), "wb").write(base64.b64decode(d["data"]))
    async def click_at(self, x, y, modifiers=0):
        for typ in ("mousePressed", "mouseReleased"):
            await self.cdp.send("Input.dispatchMouseEvent", {"type": typ, "x": x, "y": y, "button": "left", "clickCount": 1, "modifiers": modifiers}, session=self.s)
    def exceptions(self):
        out = []
        for e in self.cdp.events:
            if e["method"] == "Runtime.exceptionThrown":
                out.append(e["params"]["exceptionDetails"].get("exception", {}).get("description") or e["params"]["exceptionDetails"].get("text"))
            if e["method"] == "Runtime.consoleAPICalled":
                out.append("console." + e["params"]["type"] + ": " + " ".join(str(a.get("value", a.get("description"))) for a in e["params"]["args"]))
        return out

def run(binary, video, body):
    profile = os.environ.get("PROFILE") or tempfile.mkdtemp(prefix="profile-", dir=OUT)
    os.makedirs(profile, exist_ok=True)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=0.5); time.sleep(0.2)
        except Exception:
            break
    else:
        raise RuntimeError("port busy")
    proc = subprocess.Popen(
        [binary, f"--remote-debugging-port={PORT}", f"--user-data-dir={profile}",
         f"--load-extension={EXT}", "--disable-features=DisableLoadExtensionCommandLineSwitch",
         "--no-first-run", "--no-default-browser-check", "--window-size=1400,1000",
         "--mute-audio", "--lang=en-US", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def ws_url():
        for _ in range(100):
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version") as r:
                    return json.load(r)["webSocketDebuggerUrl"]
            except Exception:
                time.sleep(0.2)
        raise RuntimeError("browser did not start")
    async def main():
        async with websockets.connect(ws_url(), max_size=None) as ws:
            cdp = CDP(ws)
            ext = []
            for _ in range(20):
                targets = (await cdp.send("Target.getTargets"))["targetInfos"]
                ext = [t["url"] for t in targets if t["url"].startswith("chrome-extension://") and t["url"].endswith("/background.js")]
                if ext: break
                await asyncio.sleep(0.5)
            print("extension service workers:", ext)
            if not ext: raise SystemExit("EXTENSION NOT LOADED")
            await cdp.send("Browser.grantPermissions", {"permissions": ["clipboardReadWrite", "clipboardSanitizedWrite"], "origin": "https://www.youtube.com"})
            tid = (await cdp.send("Target.createTarget", {"url": "about:blank"}))["targetId"]
            s = (await cdp.send("Target.attachToTarget", {"targetId": tid, "flatten": True}))["sessionId"]
            for m in ("Page.enable", "Runtime.enable", "Network.enable"):
                await cdp.send(m, session=s)
            await cdp.send("Network.setCookie", {"name": "SOCS", "value": "CAI", "domain": ".youtube.com", "path": "/", "secure": True}, session=s)
            await cdp.send("Page.navigate", {"url": video}, session=s)
            page = Page(cdp, s)
            try:
                await body(page)
            finally:
                try: await cdp.send("Browser.close")
                except Exception: pass
    try:
        asyncio.run(main())
    finally:
        proc.terminate()
        try: proc.wait(timeout=15)
        except Exception: proc.kill(); proc.wait()
        # make sure the debugging port is released before the next launch
        for _ in range(50):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/version", timeout=0.5); time.sleep(0.2)
            except Exception:
                break
