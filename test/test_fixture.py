"""Runs content.js against test/fixture.html (classic, modern and unknown transcript markups)."""
import asyncio, sys, os, json, threading, http.server, socketserver
from harness import run
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = open(os.path.join(os.path.dirname(HERE), "content.js")).read()
CSS = open(os.path.join(os.path.dirname(HERE), "content.css")).read()
PORT = 8765
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = open(os.path.join(HERE, "fixture.html"), "rb").read()
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
srv = socketserver.TCPServer(("127.0.0.1", PORT), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
BTN = "document.getElementById('yct-copy-transcript-button')"
EXPECT = "Translator: Someone\nHear that?\nThat's nothing.\nLate line with hours"
EXPECT_TS = "0:00 Translator: Someone\n0:19 Hear that?\n0:21 That's nothing.\n1:05:03 Late line with hours"
async def body(p):
    ok_all = True
    for mode, layout in (("classic", "wide"), ("modern", "compact"), ("unknown", "compact"), ("modern", "wide")):
        await p.cdp.send("Page.navigate", {"url": f"http://127.0.0.1:{PORT}/watch?mode={mode}&layout={layout}"}, session=p.s)
        await p.wait_js("document.readyState==='complete' && !!document.getElementById('show')", 10)
        await p.ev("window.chrome={runtime:{onMessage:{addListener(){}}}}; const st=document.createElement('style'); st.textContent=" + json.dumps(CSS) + "; document.head.appendChild(st); true")
        await p.ev(SRC + "; true")
        await p.wait_js("!!" + BTN, 10)
        await asyncio.sleep(0.5)  # let the button's colour transition settle
        geo = await p.ev("(()=>{const b=" + BTN + ",s=document.querySelector('button.share');const r=b.getBoundingClientRect(),q=s.getBoundingClientRect();const cs=getComputedStyle(b),ss=getComputedStyle(s);return {w:Math.round(r.width),h:Math.round(r.height),sameRow:Math.abs(r.top-q.top)<2,sameHeight:Math.abs(r.height-q.height)<2,sameBg:cs.backgroundColor===ss.backgroundColor,bg:cs.backgroundColor,shareBg:ss.backgroundColor,iconOnly:b.classList.contains('yct-icon-only'),textShown:getComputedStyle(b.querySelector('span')).display!=='none'}})()")
        expect_icon = layout == "compact"
        geo_ok = geo["sameRow"] and geo["sameHeight"] and geo["sameBg"] and geo["iconOnly"] == expect_icon and geo["textShown"] != expect_icon and (geo["w"] <= geo["h"] + 2 if expect_icon else geo["w"] > geo["h"] * 2)
        ok_all &= geo_ok
        print(f"[{mode} {layout}] layout {'PASS' if geo_ok else 'FAIL'} {geo}")
        for shift in (False, True):
            await p.ev("window.__copied=null;" + BTN + ".dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,shiftKey:" + ("true" if shift else "false") + "}))")
            label = await p.wait_js("(()=>{const t=" + BTN + ".textContent.trim();return /^(Copied|No transcript|Copy failed)/.test(t)?t:''})()", 40)
            copied = await p.ev("window.__copied")
            panel_state = await p.ev("[...document.querySelectorAll('[target-id]')].map(e=>e.getAttribute('visibility').replace('ENGAGEMENT_PANEL_VISIBILITY_','')).join(',')")
            ok = copied == (EXPECT_TS if shift else EXPECT) and label.startswith("Copied 4") and "EXPANDED" not in panel_state
            ok_all &= ok
            print(f"[{mode} {layout}{' shift' if shift else ''}] {'PASS' if ok else 'FAIL'} label={label!r} panels={panel_state} copied={copied[:40]!r}")
            await asyncio.sleep(3)
        warn = [x[:300] for x in p.exceptions() if "Copy Transcript" in x]
        if warn: print("  console:", warn)
        p.cdp.events.clear()
    print("ALL PASS" if ok_all else "SOME FAILED")
if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 test/test_fixture.py /path/to/Chromium-or-Chrome-for-Testing")
    run(sys.argv[1], f"http://127.0.0.1:{PORT}/watch?mode=classic", body)
