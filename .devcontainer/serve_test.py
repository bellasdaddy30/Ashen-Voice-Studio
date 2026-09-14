from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path in ('/', '/index.html'):
            self.send_response(302)
            self.send_header('Location', '/runtime-test-v084.html')
            self.end_headers()
            return
        return super().do_GET()

if __name__ == '__main__':
    print('Ashen Voice v0.8.4 test: http://localhost:8080/runtime-test-v084.html', flush=True)
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
