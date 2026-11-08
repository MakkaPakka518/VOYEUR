FROM mcr.microsoft.com/playwright/python:v1.56.0-noble

WORKDIR /app
RUN pip install --no-cache-dir playwright==1.56.0 fastapi==0.115.12 uvicorn==0.34.2 python-multipart==0.0.20
COPY app.py web.py platforms.py tiktok.py threads.py x.py douyin.py collector-entrypoint.sh ./
COPY static ./static

# Let Python close persistent browser profiles before the container exits.
STOPSIGNAL SIGINT
CMD ["sh", "collector-entrypoint.sh"]
