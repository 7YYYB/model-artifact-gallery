from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit
import argparse
import base64
import json
import os
import sqlite3
import threading
import uuid
import webbrowser
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('MODEL_LIBRARY_DATA', str(ROOT / 'data')))
DB = DATA / 'library.sqlite3'
MAX_BODY = 120 * 1024 * 1024
MAX_CONTENT = 16 * 1024 * 1024
STATIC = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts"

from contextlib import contextmanager

@contextmanager
def connect():
    db = sqlite3.connect(DB, timeout=20)
    try:
        db.execute('PRAGMA journal_mode=WAL')
        with db:
            yield db
    finally:
        db.close()

def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.execute('CREATE TABLE IF NOT EXISTS items (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')

def now():
    return datetime.now(timezone.utc).isoformat()

def clean(obj, old=None):
    if not isinstance(obj, dict):
        raise ValueError('作品必须是对象')
    d = dict(old or {})
    for k, limit in [('title', 200), ('model', 120), ('category', 30), ('source', 120), ('prompt', 20000), ('notes', 20000), ('originalName', 240)]:
        val = obj.get(k, d.get(k, ''))
        if not isinstance(val, str) or len(val) > limit:
            raise ValueError(f'{k} 格式不正确或超过长度限制')
        d[k] = val.strip()
    if not d['title'] or not d['model']:
        raise ValueError('请填写作品名称和模型名称')
    d['category'] = d['category'] or '2D'
    if d['category'] not in ['2D', '3D', '网页', '图像', '其他']:
        raise ValueError('未知分类')
    tags = obj.get('tags', d.get('tags', []))
    if not isinstance(tags, list) or len(tags) > 20 or any(not isinstance(x, str) or len(x) > 40 for x in tags):
        raise ValueError('标签最多20个，每个不超过40字')
    d['tags'] = list(dict.fromkeys(x.strip() for x in tags if x.strip()))
    rating = obj.get('rating', d.get('rating', 0))
    if type(rating) is not int or not 0 <= rating <= 5:
        raise ValueError('评分应为0至5的整数')
    d['rating'] = rating
    favorite = obj.get('favorite', d.get('favorite', False))
    if type(favorite) is not bool:
        raise ValueError('收藏状态格式不正确')
    d['favorite'] = favorite
    d['kind'] = obj.get('kind', d.get('kind', 'html'))
    d['mime'] = obj.get('mime', d.get('mime', 'text/html'))
    d['content'] = obj.get('content', d.get('content', ''))
    if not isinstance(d['content'], str) or not d['content'] or len(d['content'].encode('utf-8')) > MAX_CONTENT:
        raise ValueError('作品不能为空，内容上限16MB')
    if d['kind'] == 'html':
        d['mime'] = 'text/html'
    elif d['kind'] == 'image':
        if d['mime'] not in ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']:
            raise ValueError('不支持的图片类型')
        base64.b64decode(d['content'], validate=True)
    else:
        raise ValueError('只支持HTML和图片作品')
    d['id'] = old['id'] if old else uuid.uuid4().hex
    d['createdAt'] = old['createdAt'] if old else now()
    d['updatedAt'] = now()
    d['bytes'] = len(d['content'].encode('utf-8')) if d['kind'] == 'html' else len(base64.b64decode(d['content']))
    return d

def metadata(d):
    return {k: v for k, v in d.items() if k != 'content'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print('[HTTP] ' + (fmt % args), flush=True)

    def send(self, status, content, mime='application/json; charset=utf-8', extra=None):
        if isinstance(content, (dict, list)):
            content = json.dumps(content, ensure_ascii=False).encode('utf-8')
        elif isinstance(content, str):
            content = content.encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(content)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(content)

    def safe_host(self):
        return self.headers.get('Host') in (f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}')

    def mutation_allowed(self):
        if not self.safe_host() or self.headers.get('X-Library-Request') != '1':
            return False
        origin = self.headers.get('Origin')
        return origin is None or origin in (f'http://127.0.0.1:{self.server.server_port}', f'http://localhost:{self.server.server_port}')

    def body(self):
        size = int(self.headers.get('Content-Length', '0'))
        if not 0 < size <= MAX_BODY:
            raise ValueError('请求为空或超过120MB限制')
        return json.loads(self.rfile.read(size))

    def item(self, ident):
        with connect() as db:
            row = db.execute('SELECT payload FROM items WHERE id=?', (ident,)).fetchone()
        return json.loads(row[0]) if row else None

    def do_GET(self):
        if not self.safe_host():
            return self.send(403, {'error': '仅接受本机访问'})
        path = urlsplit(self.path).path
        try:
            if path in STATIC:
                name, mime = STATIC[path]
                return self.send(200, (ROOT / name).read_bytes(), mime, {'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"})
            if path == '/api/info':
                return self.send(200, {'app': 'model-library', 'version': 1, 'dataPath': str(DB)})
            if path in ['/api/items', '/api/export']:
                with connect() as db:
                    items = [json.loads(r[0]) for r in db.execute('SELECT payload FROM items ORDER BY rowid DESC')]
                if path == '/api/export':
                    return self.send(200, {'format': 'model-library', 'version': 1, 'exportedAt': now(), 'items': items}, extra={'Content-Disposition': 'attachment; filename="model-library-backup.json"'})
                return self.send(200, {'items': [metadata(d) for d in items]})
            if path.startswith('/api/items/'):
                d = self.item(path.rsplit('/', 1)[-1])
                return self.send(200, d) if d else self.send(404, {'error': '作品不存在'})
            if path.startswith('/preview/'):
                d = self.item(path.rsplit('/', 1)[-1])
                if not d:
                    return self.send(404, '作品不存在', 'text/plain; charset=utf-8')
                if d['kind'] == 'html':
                    page = d['content']
                else:
                    page = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0;background:#10191c;display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain}</style></head><body><img alt="作品预览" src="data:' + d['mime'] + ';base64,' + d['content'] + '"></body></html>'
                return self.send(200, page, 'text/html; charset=utf-8', {'Content-Security-Policy': PREVIEW_CSP})
            return self.send(404, {'error': '页面不存在'})
        except (OSError, sqlite3.Error) as exc:
            self.send(500, {'error': str(exc)})

    def mutate(self, method):
        if not self.mutation_allowed():
            return self.send(403, {'error': '请求来源不被允许'})
        path = urlsplit(self.path).path
        try:
            if method == 'POST' and path == '/api/items':
                d = clean(self.body())
                with connect() as db:
                    db.execute('INSERT INTO items VALUES (?,?)', (d['id'], json.dumps(d, ensure_ascii=False)))
                return self.send(201, metadata(d))
            if method == 'POST' and path == '/api/import':
                body = self.body()
                if not isinstance(body, dict) or body.get('format') != 'model-library' or body.get('version') != 1 or not isinstance(body.get('items'), list):
                    raise ValueError('请选择本作品库导出的JSON备份')
                if len(body['items']) > 10000:
                    raise ValueError('单次备份最多10000条')
                items = [clean(x) for x in body['items']]
                with connect() as db:
                    db.executemany('INSERT INTO items VALUES (?,?)', [(d['id'], json.dumps(d, ensure_ascii=False)) for d in items])
                return self.send(201, {'imported': len(items)})
            if method in ['PUT', 'DELETE'] and path.startswith('/api/items/'):
                ident = path.rsplit('/', 1)[-1]
                old = self.item(ident)
                if not old:
                    return self.send(404, {'error': '作品不存在'})
                if method == 'DELETE':
                    with connect() as db:
                        db.execute('DELETE FROM items WHERE id=?', (ident,))
                    return self.send(200, {'deleted': True})
                d = clean(self.body(), old)
                with connect() as db:
                    db.execute('UPDATE items SET payload=? WHERE id=?', (json.dumps(d, ensure_ascii=False), ident))
                return self.send(200, metadata(d))
            return self.send(404, {'error': '接口不存在'})
        except (ValueError, TypeError, KeyError) as exc:
            self.send(400, {'error': str(exc)})
        except (OSError, sqlite3.Error) as exc:
            self.send(500, {'error': str(exc)})

    def do_POST(self):
        self.mutate('POST')
    def do_PUT(self):
        self.mutate('PUT')
    def do_DELETE(self):
        self.mutate('DELETE')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Local model artifact library')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--open', action='store_true')
    args = parser.parse_args()
    initialize()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as exc:
        raise SystemExit(f'Cannot start on port {args.port}: {exc}. Try --port 8766.')
    address = f'http://127.0.0.1:{server.server_port}'
    print(f'Model Library: {address}\nDatabase: {DB}', flush=True)
    if args.open:
        threading.Timer(.6, lambda: webbrowser.open(address)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
