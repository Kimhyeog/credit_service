FROM python:3.13-slim

WORKDIR /app

# 시스템 의존성 (Prisma 엔진 + SSL 연결에 필요)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Python 의존성 설치
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 소스 코드 복사
COPY . .

# Prisma 클라이언트 생성 (DATABASE_URL이 없어도 generate는 가능)
RUN PRISMA_BINARY_TARGETS=debian-openssl-3.0.x prisma generate

EXPOSE 8000

# DB 마이그레이션 + 시드 + 서버 실행
CMD prisma db push --skip-generate && python prisma/seed.py && uvicorn app.main:app --host 0.0.0.0 --port 8000
