# Phase 1 Q&A — HTTP/HTTPS, middleware/, models/ 역할

> `docs/steps/phase-01.md`의 "Step 1-1. 백엔드 디렉토리 구조 생성" 관련 질문과 답변

---

## 질문 1: HTTP vs HTTPS

> `routers/`를 "HTTP 요청을 받는 곳"이라 했는데, HTTP면 보안 문제가 많지 않나?
> HTTPS나 Nginx 설정을 해야 하는 거 아닌가?

### 답변

`routers/` 설명에서 "HTTP 요청"이라고 한 건 **프로토콜 선택이 아니라 코드 레이어의 역할**을 말한 것이다.

```
실제 운영 배포 구조:

[사용자 브라우저]
       │
       │  HTTPS (443)  ← 암호화는 여기서 처리
       ▼
┌──────────────┐
│   Nginx      │  ← SSL 인증서 설치 (Let's Encrypt 등)
│   (리버스     │     HTTPS → HTTP 변환 (SSL Termination)
│    프록시)    │
└──────┬───────┘
       │
       │  HTTP (8000)  ← 내부 통신이라 평문 OK
       ▼
┌──────────────┐
│   FastAPI    │  ← 우리가 작성하는 코드
│   (Uvicorn)  │     routers/ 코드는 여기서 동작
└──────────────┘
```

핵심:
- **FastAPI 코드(routers/)는 HTTP든 HTTPS든 똑같다** — 프로토콜 변경 시 코드를 수정할 필요 없음
- HTTPS 암호화는 **앱 바깥(Nginx, 클라우드 로드밸런서)**에서 처리하는 것이 표준
- 개발 중에는 `localhost`끼리 통신이라 HTTP로 충분하고, 배포 시 Nginx를 앞에 두면 됨

결론: 지금은 뼈대 단계라 HTTP로 개발하고, 배포 시 Nginx + HTTPS를 붙이는 방식이다.

---

## 질문 2: middleware/ vs models/ 역할

> 각각 무슨 역할인지 모르겠다. 상황 예시로 설명해달라.
> models/는 migration 할 때 schema 업데이트/생성에 필요한 코드인가?

---

### `middleware/` — 요청이 라우터에 도착하기 **전에** 가로채는 관문

```
예시 상황: 같은 주문을 실수로 2번 보냄

                    POST /api/orders
                    Idempotency-Key: abc123
                           │
                           ▼
                 ┌─────────────────────┐
                 │   middleware/       │
                 │   idempotency.py    │
                 │                     │
                 │  "abc123 키로 이전에 │
                 │   처리한 적 있나?"   │
                 │                     │
                 │   ├─ 있다 → 저장된  │──→ 바로 이전 응답 반환
                 │   │         응답     │    (라우터까지 안 감!)
                 │   │                  │
                 │   └─ 없다 → 통과    │
                 └─────────┬───────────┘
                           │ (첫 번째 요청만 통과)
                           ▼
                 ┌─────────────────────┐
                 │   routers/          │
                 │   orders.py         │
                 │                     │
                 │   실제 주문 생성     │
                 └─────────────────────┘
```

**미들웨어가 없으면?** 멱등성 체크 코드를 `orders.py`, `payments.py` 등 **모든 라우터에 복붙**해야 한다. 미들웨어에 한 번만 작성하면 모든 요청에 자동 적용.

또 다른 예시 — `error_handler.py`:

```
                     어떤 요청이든
                           │
                           ▼
                 ┌─────────────────────┐
                 │   middleware/       │
                 │   error_handler.py  │
                 │                     │
                 │   try:              │
                 │     요청을 다음으로  │──→ routers/ 실행
                 │     넘김            │
                 │   except:           │
                 │     에러 발생 시     │──→ {"error": "..."} 깔끔한 JSON 반환
                 │     500 대신 정리된  │    (500 서버 에러 페이지 대신)
                 │     응답 반환       │
                 └─────────────────────┘
```

**한 줄 요약:** middleware/는 **모든 요청에 공통으로 적용할 로직**을 넣는 곳.

---

### `models/` — 요청/응답의 **형태(shape)를 정의**하는 곳

> **DB migration 스키마가 아니다.** 그건 `prisma/schema.prisma`가 담당한다.

```
models/schemas.py 가 하는 일:

  프론트엔드가 보내는 JSON          models/가 정의한 규칙       통과하면 라우터로
  ─────────────────────     ─────────────────────     ──────────────

  {                          class OrderCreate:
    "items": [                 items: list
      {                          menu_id: str  ← 문자열이어야 함
        "menu_id": "abc",        quantity: int ← 정수여야 함, 1 이상
        "quantity": 2                Field(ge=1)
      }                        idempotency_key: str
    ],                           Field(min_length=16)  ← 16자 이상
    "idempotency_key":
      "pos_abc_1234_ef56"
  }


  만약 잘못된 요청이 오면?
  ─────────────────────

  {                          FastAPI가 자동 거부:
    "items": [],
    "quantity": -3    ← ❌    "quantity must be >= 1"
    "idempotency_key":
      "short"         ← ❌    "min_length is 16"
  }
                             → 400 Bad Request 자동 반환
                               (라우터 코드가 실행되기도 전에!)
```

**models/가 없으면?** 라우터에서 직접 검증해야 한다:

```python
# models/ 없이 라우터에서 직접 검증 (나쁜 예)
@router.post("/api/orders")
async def create_order(request: Request):
    body = await request.json()        # 타입 모름
    if "items" not in body:            # 일일이 체크
        raise HTTPException(400, ...)
    for item in body["items"]:         # 또 체크
        if item.get("quantity", 0) < 1:
            raise HTTPException(400, ...)
    # ... 10줄의 검증 코드 후에야 비즈니스 로직 시작

# models/ 사용 (좋은 예)
@router.post("/api/orders")
async def create_order(body: OrderCreate):   # ← 이 한 줄로 검증 끝
    # 여기 도달했으면 body는 100% 유효
    service.create_order(body.items, body.idempotency_key)
```

---

## 정리: 세 디렉토리의 역할 흐름

```
요청이 들어옴
     │
     ▼
┌──────────────┐
│ middleware/   │  "통행 자격 검사"  — 중복 요청? 에러 처리? 인증?
│              │  모든 요청에 공통 적용
└──────┬───────┘
       │ (통과)
       ▼
┌──────────────┐
│ models/      │  "짐 검사"  — 요청 데이터가 올바른 형태인가?
│ (Pydantic)   │  price가 숫자인가? quantity가 1 이상인가?
└──────┬───────┘
       │ (유효)
       ▼
┌──────────────┐
│ routers/     │  "실제 처리"  — 주문 생성, 결제 승인 등
│              │  비즈니스 로직 호출
└──────────────┘
```

---

## 부록: DB 관련 파일 위치 구분

| 파일 | 역할 | migration 관련? |
|------|------|:---:|
| `prisma/schema.prisma` | DB 테이블 구조 정의, migration | **O** |
| `app/db/client.py` | Prisma 연결 초기화 | X |
| `app/models/schemas.py` | HTTP 요청/응답 형태 검증 | **X** |

`models/schemas.py`는 **HTTP 레벨 계약**이고, `prisma/schema.prisma`는 **DB 레벨 계약**이다. 둘은 별개다.
