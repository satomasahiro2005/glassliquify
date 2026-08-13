"""Spotify の中の xpui を CDP 経由で直接叩く。

Spotify を --remote-debugging-port=9222 付きで起動しておくこと。
画面キャプチャと推測でガラスを詰めるのは無理だったので、実物を測るための道具。

    python tools/cdp.py eval "document.title"
    python tools/cdp.py evalfile probe.js
    python tools/cdp.py shot out.png
    python tools/cdp.py targets            # ページ一覧
"""
import base64
import json
import sys
import urllib.request

import websocket  # websocket-client

PORT = 9222


def page_ws(match="xpui"):
    raw = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5).read()
    pages = json.loads(raw)
    for p in pages:
        if p.get("type") == "page" and match in (p.get("url") or ""):
            return p["webSocketDebuggerUrl"], p
    for p in pages:
        if p.get("type") == "page":
            return p["webSocketDebuggerUrl"], p
    raise SystemExit("no page target; is Spotify running with --remote-debugging-port?")


class Session:
    def __init__(self):
        url, self.page = page_ws()
        # Chrome 111+ rejects the handshake if an Origin header is present and
        # --remote-allow-origins was not passed. Just do not send one.
        self.ws = websocket.create_connection(url, timeout=30, suppress_origin=True)
        self.id = 0

    def send(self, method, **params):
        self.id += 1
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.id:
                if "error" in msg:
                    raise RuntimeError(msg["error"])
                return msg.get("result", {})

    def evaluate(self, expr):
        r = self.send(
            "Runtime.evaluate",
            expression=expr,
            returnByValue=True,
            awaitPromise=True,
            allowUnsafeEvalBlockedByCSP=True,
        )
        if r.get("exceptionDetails"):
            d = r["exceptionDetails"]
            desc = (d.get("exception") or {}).get("description") or d.get("text")
            raise RuntimeError(desc)
        return r.get("result", {}).get("value")

    def mouse(self, x, y):
        """本物のポインタ移動。合成 MouseEvent では :hover が立たない。"""
        self.send("Input.dispatchMouseEvent", type="mouseMoved", x=x, y=y, buttons=0)

    def screenshot(self, path):
        r = self.send("Page.captureScreenshot", format="png", captureBeyondViewport=False)
        with open(path, "wb") as f:
            f.write(base64.b64decode(r["data"]))
        return path


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]

    if cmd == "targets":
        raw = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json/list", timeout=5).read()
        for p in json.loads(raw):
            print(p.get("type"), "|", p.get("title"), "|", p.get("url"))
        return

    s = Session()
    if cmd == "eval":
        out = s.evaluate(sys.argv[2])
    elif cmd == "evalfile":
        out = s.evaluate(open(sys.argv[2], encoding="utf-8").read())
    elif cmd == "mouse":
        s.mouse(float(sys.argv[2]), float(sys.argv[3]))
        out = "moved to %s,%s" % (sys.argv[2], sys.argv[3])
    elif cmd == "shot":
        out = s.screenshot(sys.argv[2] if len(sys.argv) > 2 else "shot.png")
    else:
        raise SystemExit(f"unknown command: {cmd}")

    if isinstance(out, (dict, list)):
        print(json.dumps(out, ensure_ascii=False, indent=1))
    else:
        print(out)


if __name__ == "__main__":
    main()
