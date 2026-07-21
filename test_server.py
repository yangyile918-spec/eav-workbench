import http.server
import socketserver
PORT = 8001
Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'Serving on http://localhost:{PORT}')
    for _ in range(10):
        httpd.handle_request()
