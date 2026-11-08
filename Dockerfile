FROM mcr.microsoft.com/playwright/python:v1.56.0-noble

WORKDIR /app
RUN pip install --no-cache-dir playwright==1.56.0 fastapi==0.115.12 uvicorn==0.34.2 python-multipart==0.0.20
COPY app.py web.py ./
COPY static ./static

CMD ["python", "-u", "app.py"]
