# Toss-Sync POS 배포 가이드 — Neon + Render + Vercel (무료)

## 아키텍처

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Vercel     │     │   Render     │     │    Neon      │
│  (무료)      │     │  (무료)      │     │  (무료)      │
│  Frontend    │────→│  Backend     │────→│  PostgreSQL  │
│  Next.js     │     │  FastAPI     │     │  0.5GB       │
│  자동 SSL    │     │  Docker      │     │  자동 백업   │
└──────────────┘     └──────────────┘     └──────────────┘
```

---

## Step 1: GitHub에 코드 푸시

배포 전 모든 변경사항을 커밋하고 GitHub에 푸시합니다.

```bash
git add -A
git commit -m "배포 준비: PostgreSQL 전환 + Dockerfile 추가"
git push origin main
```

---

## Step 2: Neon (PostgreSQL) 설정

1. https://neon.tech 에 가입 (GitHub 로그인 가능)
2. **New Project** 클릭
   - Project name: `toss-sync-pos`
   - Region: `Asia Pacific (Singapore)` ← 한국에서 가장 가까움
3. 생성 후 **Connection string** 복사 (형식):
   ```
   postgresql://username:password@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```
4. 이 URL을 메모장에 저장 (다음 단계에서 사용)

---

## Step 3: Render (Backend) 배포

1. https://render.com 에 가입 (GitHub 로그인 가능)
2. Dashboard → **New** → **Web Service**
3. GitHub 저장소 연결 → `credit_service` 선택
4. 설정:

| 항목 | 값 |
|------|-----|
| Name | `toss-sync-pos-api` |
| Region | `Singapore` |
| Root Directory | `backend` |
| Runtime | `Docker` |
| Instance Type | `Free` |

5. **Environment Variables** 추가 (Add Environment Variable):

| Key | Value |
|-----|-------|
| `DATABASE_URL` | Step 2에서 복사한 Neon URL |
| `TOSS_SECRET_KEY` | `test_sk_Poxy1XQL8RbkyDynGYW487nO5Wml` |
| `TOSS_WEBHOOK_SECRET` | 현재 사용 중인 웹훅 시크릿 |
| `CORS_ORIGINS` | `https://toss-sync-pos.vercel.app` (Step 4 후 실제 URL로 수정) |

6. **Create Web Service** 클릭
7. 빌드 완료까지 3~5분 대기
8. 배포 완료 후 URL 확인 (예: `https://toss-sync-pos-api.onrender.com`)
9. 헬스체크 확인:
   ```
   https://toss-sync-pos-api.onrender.com/api/health
   → {"status": "ok"}
   ```

---

## Step 4: Vercel (Frontend) 배포

1. https://vercel.com 에 가입 (GitHub 로그인 가능)
2. **Add New Project** → GitHub 저장소 `credit_service` 선택
3. 설정:

| 항목 | 값 |
|------|-----|
| Framework Preset | `Next.js` (자동 감지) |
| Root Directory | `frontend` |

4. **Environment Variables** 추가:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_API_URL` | `https://toss-sync-pos-api.onrender.com` (Step 3의 Render URL) |
| `NEXT_PUBLIC_TOSS_CLIENT_KEY` | `test_ck_ALnQvDd2VJ6GMNGK0BzYVMj7X41m` |
| `NEXT_PUBLIC_PAYMENT_MOCK` | `false` |

5. **Deploy** 클릭
6. 배포 완료 후 URL 확인 (예: `https://toss-sync-pos.vercel.app`)

---

## Step 5: CORS 업데이트

Vercel URL이 확정되면 Render에서 CORS를 업데이트합니다.

1. Render Dashboard → `toss-sync-pos-api` → Environment
2. `CORS_ORIGINS` 값을 실제 Vercel URL로 변경:
   ```
   https://toss-sync-pos.vercel.app
   ```
3. **Save Changes** → 자동 재배포됨

---

## Step 6: 동작 확인

1. Vercel URL 접속 → POS 화면 표시
2. 메뉴 목록이 로드되는지 확인 (백엔드 API 연결)
3. 메뉴 선택 → "결제하기" → Toss 결제 테스트
4. `/admin/orders` → KDS에서 주문 확인

---

## 환경변수 요약

### Render (Backend)

```
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
TOSS_SECRET_KEY=test_sk_...
TOSS_WEBHOOK_SECRET=...
CORS_ORIGINS=https://your-app.vercel.app
```

### Vercel (Frontend)

```
NEXT_PUBLIC_API_URL=https://your-api.onrender.com
NEXT_PUBLIC_TOSS_CLIENT_KEY=test_ck_...
NEXT_PUBLIC_PAYMENT_MOCK=false
```

---

## 트러블슈팅

### "CORS 에러" — 프론트에서 API 호출 시

Render의 `CORS_ORIGINS`에 Vercel URL이 정확히 들어있는지 확인.
끝에 `/` 붙이지 않기. (예: `https://app.vercel.app` ✅, `https://app.vercel.app/` ❌)

### "API 응답 없음" — Render 서버 슬립

무료 tier는 15분 미사용 시 슬립. 첫 요청에 30초~1분 대기 후 자동 기상.

### "DB 연결 실패"

Neon의 Connection string에 `?sslmode=require`가 포함되어 있는지 확인.

### 재배포

코드 수정 후 `git push origin main`하면 Render와 Vercel 모두 자동 재배포됩니다.

---

## 라이브 전환 시 (실제 결제)

테스트 완료 후 실제 결제를 받으려면:

1. [Toss 개발자 센터](https://developers.tosspayments.com) → 라이브 키 발급
2. Render: `TOSS_SECRET_KEY` → 라이브 시크릿 키로 교체
3. Vercel: `NEXT_PUBLIC_TOSS_CLIENT_KEY` → 라이브 클라이언트 키로 교체
4. Toss 대시보드에 웹훅 URL 등록: `https://your-api.onrender.com/api/webhooks/toss`
