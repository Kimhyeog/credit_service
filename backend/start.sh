#!/bin/bash
set -e

# Neon DB가 슬립 상태일 수 있으므로 재시도
MAX_RETRIES=5
for i in $(seq 1 $MAX_RETRIES); do
    echo "DB 연결 시도 ($i/$MAX_RETRIES)..."
    if prisma db push --skip-generate 2>&1; then
        echo "DB 스키마 적용 완료"
        break
    fi
    if [ $i -eq $MAX_RETRIES ]; then
        echo "DB 연결 실패"
        exit 1
    fi
    echo "재시도 대기 (5초)..."
    sleep 5
done

python prisma/seed.py
uvicorn app.main:app --host 0.0.0.0 --port 8000
