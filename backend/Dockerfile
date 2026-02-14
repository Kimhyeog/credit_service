FROM python:3.13-slim

WORKDIR /app

# 시스템 의존성 (Prisma 엔진 빌드에 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

# Prisma 클라이언트 생성
RUN prisma generate

EXPOSE 8000

# DB 마이그레이션 + 서버 실행
CMD prisma db push --skip-generate && python prisma/seed.py && uvicorn app.main:app --host 0.0.0.0 --port 8000
