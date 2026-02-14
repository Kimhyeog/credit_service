# Phase 14 — 마무리 & 배포 준비

## 목표

- .gitignore 정비 및 추적 중인 불필요 파일 제거
- npm scripts 추가 (test)
- 백엔드 에러 메시지 한글화
- 최종 E2E 검증 체크리스트 수행

---

## 현재 상태 분석

### .gitignore 문제

현재 루트 `.gitignore`:
```
backend/.env
backend/dev.db
backend/venv/
frontend/.env.local
frontend/node_modules/
frontend/.next/
```

**누락된 항목:**
| 패턴 | 이유 |
|------|------|
| `__pycache__/` | Python 바이트코드 — 이미 여러 `.pyc` 파일이 git에 추적되고 있음 |
| `*.pyc` | 개별 바이트코드 파일 |
| `backend/prisma/test.db` | Phase 13에서 생성한 테스트 DB |
| `.pytest_cache/` | pytest 캐시 디렉토리 |
| `.DS_Store` | macOS 시스템 파일 |

**이미 추적 중인 `__pycache__/` 파일** (git status에서 확인):
```
M  backend/app/__pycache__/main.cpython-313.pyc
M  backend/app/models/__pycache__/schemas.cpython-313.pyc
M  backend/app/routers/__pycache__/orders.cpython-313.pyc
...
```

### npm scripts 문제

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start"
  // ← "test" 없음!
}
```

### 백엔드 에러 메시지

영어로 된 에러 메시지 목록 (사용자에게 노출 가능):

| 파일 | 메시지 | 한글화 대상 |
|------|--------|-------------|
| `order_service.py:25` | `"Menu not found: {id}"` | O |
| `order_service.py:72` | `"Order not found"` | O |
| `order_service.py:79` | `"Cannot cancel order in {status} status"` | O |
| `order_service.py:98` | `"Cannot transition from {a} to {b}..."` | O |
| `payment_service.py:25` | `"Order not found"` | O |
| `payment_service.py:30` | `"Amount mismatch..."` | O |
| `payment_service.py:35` | `"Order is not in payable status: {status}"` | O |
| `payment_service.py:124` | `"Payment not found for this order"` | O |
| `payment_service.py:142` | `"Cannot cancel payment in {status} status"` | O |
| `payment_service.py:148` | `"No payment key — cannot cancel via Toss"` | O |

### 이미 양호한 항목

- **console.log**: 모두 `NODE_ENV === "development"` 가드 안에 있음 → 변경 불필요
- **사용하지 않는 import**: 탐색 결과 없음
- **TypeScript strict mode**: 활성화됨
- **Error boundary**: `frontend/src/app/error.tsx` 존재
- **환경 변수**: 실제 Toss 테스트 키 사용 중 (`PAYMENT_MOCK=false`)

---

## 생성/수정 파일 (5개)

| # | 파일 | 변경 내용 |
|---|------|-----------|
| 1 | `.gitignore` | `__pycache__/`, `*.pyc`, `test.db`, `.pytest_cache/`, `.DS_Store` 추가 |
| 2 | `frontend/package.json` | `test`, `test:watch` scripts 추가 |
| 3 | `backend/app/services/order_service.py` | 에러 메시지 한글화 |
| 4 | `backend/app/services/payment_service.py` | 에러 메시지 한글화 |
| 5 | (git 명령) | 추적 중인 `__pycache__/` 인덱스에서 제거 |

---

## 구현 순서

### Step 1. .gitignore 수정

**파일:** `.gitignore` (루트)

```gitignore
# backend
backend/.env
backend/venv/
__pycache__/
*.pyc
*.py[cod]
.pytest_cache/
backend/prisma/dev.db
backend/prisma/test.db

# frontend
frontend/.env.local
frontend/node_modules/
frontend/.next/

# OS
.DS_Store
```

**변경점:**
- `__pycache__/` + `*.pyc` + `*.py[cod]` — 모든 Python 바이트코드
- `.pytest_cache/` — pytest 캐시
- `backend/prisma/test.db` — 테스트 DB
- `backend/dev.db` → `backend/prisma/dev.db` — 실제 경로 수정 (dev.db는 prisma/ 안에 생성됨)
- `.DS_Store` — macOS 시스템 파일

### Step 2. 추적 중인 __pycache__ 제거

```bash
cd <project-root>
git rm --cached -r "backend/app/__pycache__"
git rm --cached -r "backend/app/models/__pycache__"
git rm --cached -r "backend/app/routers/__pycache__"
git rm --cached -r "backend/app/services/__pycache__"
git rm --cached -r "backend/app/db/__pycache__"
# 기타 추적 중인 __pycache__ 디렉토리도 제거
```

**주의:** `git rm --cached`는 파일 시스템에서는 삭제하지 않고 git 인덱스에서만 제거.

### Step 3. npm scripts 추가

**파일:** `frontend/package.json`

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

### Step 4. 백엔드 에러 메시지 한글화

**파일:** `backend/app/services/order_service.py`

| 기존 | 변경 |
|------|------|
| `"Menu not found: {id}"` | `"메뉴를 찾을 수 없습니다: {id}"` |
| `"Order not found"` | `"주문을 찾을 수 없습니다"` |
| `"Cannot cancel order in {status} status"` | `"{status} 상태의 주문은 취소할 수 없습니다"` |
| `"Cannot transition from {a} to {b}. Allowed: {c}"` | `"{a}에서 {b}(으)로 전환할 수 없습니다. 가능: {c}"` |

**파일:** `backend/app/services/payment_service.py`

| 기존 | 변경 |
|------|------|
| `"Order not found"` | `"주문을 찾을 수 없습니다"` |
| `"Amount mismatch: order={a}, request={b}"` | `"결제 금액이 일치하지 않습니다: 주문={a}, 요청={b}"` |
| `"Order is not in payable status: {status}"` | `"결제 가능한 상태가 아닙니다: {status}"` |
| `"Payment not found for this order"` | `"이 주문의 결제 정보를 찾을 수 없습니다"` |
| `"Cannot cancel payment in {status} status"` | `"{status} 상태의 결제는 취소할 수 없습니다"` |
| `"No payment key — cannot cancel via Toss"` | `"결제 키가 없어 취소할 수 없습니다"` |
| `"Payment failed: {reason}"` | `"결제 실패: {reason}"` |
| `"Cancel failed: {reason}"` | `"취소 실패: {reason}"` |

**테스트 영향:**
- `test_payments.py::test_confirm_amount_mismatch`에서 `"mismatch"` 문자열 검증 → 한글로 변경 필요:
  ```python
  # 기존: assert "mismatch" in res.json()["detail"].lower()
  # 변경: assert "일치" in res.json()["detail"]
  ```

### Step 5. 최종 검증

```bash
# 1. 백엔드 테스트 (한글화 후)
cd backend && source venv/bin/activate && pytest -v

# 2. 프론트엔드 테스트
cd frontend && npm test

# 3. 프론트엔드 빌드
cd frontend && npm run build

# 4. E2E 수동 검증 (백엔드 + 프론트엔드 실행 후)
# POS (/): 메뉴 선택 → 장바구니 → 결제 → 성공 → POS 복귀
# 키오스크 (/kiosk): 메뉴 선택 → 주문 → 결제 → 복귀
# 테이블오더 (/order/1): 메뉴 선택 → 주문 → 결제 → 복귀
# 관리자 (/admin): 매출 요약 → 주문 목록 → 상세 모달
# KDS (/admin/orders): 칸반 보드 → 상태 전환 (접수→준비중→완료)
# 테마 전환: 라이트 ↔ 다크
# 오프라인: DevTools Network Offline → 배너 표시 + 결제 차단
# 중복 탭: 탭 2개에서 동시 결제 → 두 번째 탭 차단
```

---

## 파일 체크리스트

- [ ] `.gitignore` — `__pycache__/`, `*.pyc`, `test.db`, `.pytest_cache/`, `.DS_Store` 추가
- [ ] `frontend/package.json` — `test`, `test:watch` scripts 추가
- [ ] `backend/app/services/order_service.py` — 에러 메시지 한글화
- [ ] `backend/app/services/payment_service.py` — 에러 메시지 한글화
- [ ] `backend/tests/test_payments.py` — 한글화에 맞춰 assertion 수정
- [ ] 추적 중인 `__pycache__/` git 인덱스에서 제거
- [ ] `pytest -v` 전체 통과
- [ ] `npm test` 전체 통과
- [ ] `npm run build` 성공
