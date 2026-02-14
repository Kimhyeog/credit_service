# CORS, HTTP, HTTPS 개념 정리

> Phase 2-6의 CORS 미들웨어 설정을 이해하기 위한 배경 지식

---

## 1. HTTP와 HTTPS

### HTTP (HyperText Transfer Protocol)

브라우저와 서버가 데이터를 주고받는 **규약(프로토콜)**이다.

```
[브라우저] ---HTTP 요청--→ [서버]
           ←--HTTP 응답---
```

- 요청: "메뉴 목록 줘" → `GET /api/menus`
- 응답: `200 OK` + JSON 데이터

**문제:** HTTP는 데이터를 **평문(plain text)**으로 전송한다. 중간에 누군가 가로채면(패킷 스니핑) 내용이 그대로 보인다.

```
브라우저 → [해커가 엿봄 👀] → 서버
         "password=1234"    ← 그대로 노출
```

### HTTPS (HTTP + Secure)

HTTP에 **TLS/SSL 암호화**를 씌운 것이다.

```
브라우저 → [해커가 엿봄 👀] → 서버
         "aX3$k9!@#..."    ← 암호화되어 의미 없음
```

| 비교   | HTTP      | HTTPS          |
| ------ | --------- | -------------- |
| 포트   | 80        | 443            |
| 암호화 | 없음      | TLS/SSL        |
| URL    | `http://` | `https://`     |
| 용도   | 로컬 개발 | 운영 환경 필수 |

**이 프로젝트에서:** 개발 환경은 `http://localhost`를 사용하고, 운영에 배포하면 HTTPS를 적용한다.
Toss Payments API(`https://api.tosspayments.com`)는 이미 HTTPS를 사용 중이다.

---

## 2. Origin(출처)이란?

브라우저는 URL의 세 가지 요소를 합쳐서 "출처(origin)"를 판별한다:

```
https://example.com:443/path
──┬──   ───┬──────  ─┬─
프로토콜    호스트     포트
```

**세 가지가 모두 같아야 "같은 출처"**이다.

| URL A                   | URL B                        | 같은 출처? | 이유                            |
| ----------------------- | ---------------------------- | ---------- | ------------------------------- |
| `http://localhost:3000` | `http://localhost:3000/menu` | O          | 프로토콜+호스트+포트 동일       |
| `http://localhost:3000` | `http://localhost:8000`      | **X**      | 포트가 다름 (3000 vs 8000)      |
| `http://localhost:3000` | `https://localhost:3000`     | **X**      | 프로토콜이 다름 (http vs https) |
| `https://mypos.com`     | `https://api.mypos.com`      | **X**      | 호스트가 다름                   |

**이 프로젝트의 상황:**

```
프론트엔드: http://localhost:3000  ← Origin A
백엔드:     http://localhost:8000  ← Origin B (포트가 다름!)
```

포트가 다르므로 브라우저는 이 둘을 **다른 출처**로 본다.

---

## 3. 동일 출처 정책 (Same-Origin Policy)

브라우저에 내장된 **보안 규칙**이다:

> "자바스크립트는 **자신과 같은 출처**의 리소스만 요청할 수 있다."

### 왜 이런 규칙이 있나?

이 규칙이 없다면 이런 공격이 가능하다:

```
1. 사용자가 은행 사이트(bank.com)에 로그인 (쿠키 저장)
2. 악성 사이트(evil.com)를 방문
3. evil.com의 자바스크립트가 bank.com/api/transfer로 요청
4. 브라우저가 bank.com 쿠키를 자동 첨부 → 돈이 빠져나감
```

동일 출처 정책이 있으면:

```
3. evil.com의 자바스크립트가 bank.com/api/transfer로 요청
4. 브라우저: "evil.com ≠ bank.com → 차단!" 🛡️
```

### 핵심: 브라우저만 적용하는 규칙

```
[브라우저 → 서버]  → 동일 출처 정책 적용 ✓
[서버 → 서버]      → 적용 안 됨 ✗
[curl → 서버]      → 적용 안 됨 ✗
[Postman → 서버]   → 적용 안 됨 ✗
```

그래서 `curl`로 API를 테스트할 때는 CORS 에러가 안 나지만, 브라우저에서 `fetch()`로 호출하면 에러가 난다.

---

## 4. CORS (Cross-Origin Resource Sharing)

동일 출처 정책의 **예외를 허용하는 메커니즘**이다.

> "서버가 명시적으로 허용한 출처는 다른 출처여도 요청을 허용한다."

### 동작 원리

#### 단순 요청 (Simple Request)

```
1. 브라우저: GET /api/menus 요청
   + Origin: http://localhost:3000 헤더 자동 추가

2. 서버 응답:
   + Access-Control-Allow-Origin: http://localhost:3000

3. 브라우저: "서버가 허용했네 → 응답을 자바스크립트에 전달"
```

#### 사전 요청 (Preflight Request)

POST, PUT, PATCH 등 "부수 효과가 있는" 요청은 브라우저가 **먼저 물어본다**:

```
1. 브라우저: OPTIONS /api/orders (사전 요청)
   "나 POST 보내도 돼? Content-Type: application/json 써도 돼?"
   + Origin: http://localhost:3000
   + Access-Control-Request-Method: POST
   + Access-Control-Request-Headers: Content-Type, Idempotency-Key

2. 서버: "허용한다"
   + Access-Control-Allow-Origin: http://localhost:3000
   + Access-Control-Allow-Methods: POST, GET, PATCH, DELETE
   + Access-Control-Allow-Headers: Content-Type, Idempotency-Key

3. 브라우저: "OK, 진짜 요청 보낸다"
   POST /api/orders + body
```

### CORS 없으면 생기는 에러

프론트엔드(`localhost:3000`)에서 백엔드(`localhost:8000`)로 fetch 호출 시:

```
Access to fetch at 'http://localhost:8000/api/menus' from origin
'http://localhost:3000' has been blocked by CORS policy: No
'Access-Control-Allow-Origin' header is present on the requested resource.
```

---

## 5. 이 프로젝트의 CORS 설정 해석

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,   # ["http://localhost:3000"]
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

| 옵션                | 값                          | 의미                                                   |
| ------------------- | --------------------------- | ------------------------------------------------------ |
| `allow_origins`     | `["http://localhost:3000"]` | 이 출처에서 오는 요청만 허용                           |
| `allow_credentials` | `True`                      | 쿠키/인증 정보 포함 요청 허용                          |
| `allow_methods`     | `["*"]`                     | GET, POST, PATCH, DELETE 등 모든 HTTP 메서드 허용      |
| `allow_headers`     | `["*"]`                     | Content-Type, Idempotency-Key 등 모든 커스텀 헤더 허용 |

**`allow_origins`를 `["*"]`로 하면 안 되는 이유:**

모든 출처를 허용하면 아까의 은행 공격 시나리오와 같은 문제가 생긴다. 우리 프론트엔드 출처만 명시적으로 허용하는 것이 안전하다.

---

## 6. 정리: 왜 CORS가 필요한가?

```
┌──────────────────┐        ┌──────────────────┐
│  프론트엔드         │  HTTP  │  백엔드           │
│  localhost:3000  │───────→│  localhost:8000   │
│                  │        │                   │
│ fetch('/api/..') │  포트가 다름 = 다른 출처!    │
└──────────────────┘        └──────────────────┘
                    │
          브라우저가 차단 🛡️
          "CORS 설정이 없으면 응답 안 줌"
                    │
          해결: 서버에 CORSMiddleware 추가
          → "localhost:3000은 허용해"
```

- 서버 → 서버 통신(백엔드 → Toss API)에는 CORS가 관계없다
- CORS는 **브라우저의 보안 정책**이다
- 개발 환경에서 프론트/백 포트가 다르기 때문에 반드시 설정해야 한다
