import json
import tempfile
import threading
import urllib.request
import urllib.error
from pathlib import Path
import server


def main():
    with tempfile.TemporaryDirectory(prefix='.verify-', dir=Path(__file__).resolve().parent) as temp:
        server.DATA = Path(temp)
        server.DB = server.DATA / 'library.sqlite3'
        server.initialize()
        http = server.ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
        thread = threading.Thread(target=http.serve_forever, daemon=True)
        thread.start()
        root = f'http://127.0.0.1:{http.server_port}'
        def request(path, method='GET', body=None, headers=None):
            data = None if body is None else json.dumps(body).encode()
            req = urllib.request.Request(root + path, data=data, method=method, headers={'Content-Type':'application/json','X-Library-Request':'1',**(headers or {})})
            try:
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=5) as r:
                    return r.status, r.read(), r.headers
            except urllib.error.HTTPError as e:
                return e.code, e.read(), e.headers
        try:
            assert request('/api/info')[0] == 200
            assert request('/')[0] == 200
            assert request('/app.js')[0] == 200
            assert request('/data/library.sqlite3')[0] == 404
            item = {'title':'接口验证临时作品','model':'验证模型','kind':'html','content':'<!doctype html><h1>hello</h1>','tags':['验证'],'category':'2D'}
            status, raw, _ = request('/api/items','POST',item)
            assert status == 201, raw
            ident = json.loads(raw)['id']
            listing = json.loads(request('/api/items')[1])['items']
            assert len(listing) == 1 and 'content' not in listing[0]
            assert json.loads(request('/api/items/'+ident)[1])['content'] == item['content']
            assert request('/api/items/'+ident,'PUT',{'rating':5,'favorite':True})[0] == 200
            status, page, headers = request('/preview/'+ident)
            assert status == 200 and b'<h1>hello</h1>' in page
            assert "sandbox allow-scripts" in headers['Content-Security-Policy']
            assert "connect-src 'none'" in headers['Content-Security-Policy']
            assert request('/api/items','POST',item,{'Origin':'https://example.invalid'})[0] == 403
            assert request('/api/items','POST',item,{'Origin':'null'})[0] == 403
            assert request('/api/items','POST',item,{'X-Library-Request':''})[0] == 403
            assert request('/api/info',headers={'Host':'evil.invalid'})[0] == 403
            backup = json.loads(request('/api/export')[1])
            assert backup['items'][0]['rating'] == 5
            assert request('/api/import','POST',backup)[0] == 201
            bad = {'format':'model-library','version':1,'items':[item,{'title':'bad'}]}
            assert request('/api/import','POST',bad)[0] == 400
            assert len(json.loads(request('/api/items')[1])['items']) == 2
            assert request('/api/items/'+ident,'DELETE')[0] == 200
            assert request('/api/items/'+ident)[0] == 404
            assert request('/api/items','POST',{**item,'rating':99})[0] == 400
            print('PASS: static pages, SQLite CRUD, metadata filtering, ratings/favorites, backup/restore, atomic invalid import, sandbox CSP, origin/host guards.')
        finally:
            http.shutdown()
            http.server_close()
            thread.join(timeout=3)

if __name__ == '__main__':
    main()
