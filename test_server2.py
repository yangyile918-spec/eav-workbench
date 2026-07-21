import http.server, socketserver, os
os.chdir(r'D:\Work-ai\EAV desktop\workbench')
PORT = 8002
Handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'Serving on http://localhost:{PORT}')
    for _ in range(20):
        httpd.handle_request()