"""Hot-reload the app in the playground, and print whether it compiled.

    python3 playground/reload.py [--restart] [port]

Asks serve.py (the port in playground/playground.json, or PLAYGROUND_PORT,
unless given) to rewrite the registry and reload the app it runs (--restart:
start the app again, with its state back to the start). Prints the compile errors, if any, and exits 1 on a failure.
The playground's chat runs this after changing a version, to check its work.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def main(argv):
    restart = "--restart" in argv
    ports = [a for a in argv if a.isdigit()]
    config = json.loads((Path(__file__).resolve().parent / "playground.json").read_text())
    port = int(ports[0]) if ports else int(os.environ.get("PLAYGROUND_PORT", config.get("port", 8820)))
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/playground/app/reload",
        data=json.dumps({"restart": restart}).encode(),
        headers={"Content-Type": "application/json", "X-Playground": "reload"},
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as r:
            result = json.loads(r.read())
    except urllib.error.HTTPError as e:
        result = json.loads(e.read() or b"{}") or {"ok": False, "message": f"serve.py said {e.code}"}
    except OSError:
        print(f"serve.py isn't running on port {port}, so the app couldn't be reloaded.")
        return 1
    print(result.get("message", ""))
    for line in result.get("errors", []):
        print(line)
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
