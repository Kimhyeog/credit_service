FROM python:3.13-slim

WORKDIR /app

# 시스템 의존성
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Node.js 설치 (Prisma CLI에 필요)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

# Prisma 클라이언트 생성
RUN python -m prisma generate

EXPOSE 8000

CMD prisma db push --skip-generate && python prisma/seed.py && uvicorn app.main:app --host 0.0.0.0 --port 8000
