from pathlib import Path
import json
import socket
import subprocess
import sys
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
expected = (ROOT / 'data' / 'library.sqlite3').resolve()
for port in range(8765, 8776):
    url = f'http://127.0.0.1:{port}'
    try:
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(url + '/api/info', timeout=.6) as response:
            info = json.load(response)
        if info.get('app') == 'model-library' and Path(info.get('dataPath', '')).resolve() == expected:
            print('Opening existing library: ' + url)
            webbrowser.open(url)
            raise SystemExit(0)
    except (OSError, ValueError):
        pass
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            continue
    print('Starting local library: ' + url, flush=True)
    raise SystemExit(subprocess.call([sys.executable, str(ROOT / 'server.py'), '--port', str(port), '--open'], cwd=ROOT))
raise SystemExit('Ports 8765-8775 are occupied. Run: py -3 server.py --port 8780 --open')
