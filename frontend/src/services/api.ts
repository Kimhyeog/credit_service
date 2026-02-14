const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── 인터셉터 타입 정의 ─────────────────────────────────────

/** 요청 설정 객체 — 인터셉터가 가공하는 대상 */
interface RequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** API 에러 — 모든 에러를 이 형태로 정규화 */
export interface ApiError {
  detail: string;
  status: number;
}

/** 요청 인터셉터: 요청이 나가기 전에 config를 가공 */
type RequestInterceptor = (config: RequestConfig) => RequestConfig;

/** 응답 인터셉터: 응답이 돌아온 후 가공 (에러 처리 포함) */
type ResponseInterceptor = (response: Response, config: RequestConfig) => Response | Promise<Response>;

// ─── ApiClient 클래스 ─────────────────────────────────────

class ApiClient {
  private baseUrl: string;
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** 요청 인터셉터 등록 */
  addRequestInterceptor(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
  }

  /** 응답 인터셉터 등록 */
  addResponseInterceptor(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
  }

  // ─── 핵심: 모든 요청이 통과하는 단일 메서드 ───

  private async request<T>(config: RequestConfig): Promise<T> {
    // 1) 요청 인터셉터 실행 (순서대로)
    let processedConfig = config;
    for (const interceptor of this.requestInterceptors) {
      processedConfig = interceptor(processedConfig);
    }

    // 2) 실제 fetch 실행
    let response = await fetch(processedConfig.url, {
      method: processedConfig.method,
      headers: processedConfig.headers,
      body: processedConfig.body,
    });

    // 3) 응답 인터셉터 실행 (순서대로)
    for (const interceptor of this.responseInterceptors) {
      response = await interceptor(response, processedConfig);
    }

    return response.json();
  }

  // ─── 공개 메서드: get / post / patch ───

  async get<T>(
    path: string,
    options?: { params?: Record<string, string | undefined> },
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (options?.params) {
      Object.entries(options.params).forEach(([key, value]) => {
        if (value !== undefined) url.searchParams.set(key, value);
      });
    }

    return this.request<T>({
      url: url.toString(),
      method: "GET",
      headers: {},
    });
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>({
      url: `${this.baseUrl}${path}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(
    path: string,
    body?: unknown,
    options?: { headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>({
      url: `${this.baseUrl}${path}`,
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

// ─── 인터셉터 정의 ─────────────────────────────────────

/** 에러 정규화 인터셉터: res.ok가 아니면 ApiError로 throw */
const errorInterceptor: ResponseInterceptor = async (response, config) => {
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw {
      detail: body.detail || response.statusText,
      status: response.status,
    } as ApiError;
  }
  return response;
};

/** 로깅 인터셉터 (개발 환경 전용): API 호출 추적 */
const loggingRequestInterceptor: RequestInterceptor = (config) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] → ${config.method} ${config.url}`);
  }
  return config;
};

const loggingResponseInterceptor: ResponseInterceptor = (response, config) => {
  if (process.env.NODE_ENV === "development") {
    console.log(`[API] ← ${response.status} ${config.method} ${config.url}`);
  }
  return response;
};

// ─── 인스턴스 생성 & 인터셉터 등록 ─────────────────────

const api = new ApiClient(BASE_URL);

// 순서 중요: 로깅 → fetch → 에러 체크 → 로깅
api.addRequestInterceptor(loggingRequestInterceptor);
api.addResponseInterceptor(errorInterceptor);          // 에러를 먼저 체크
api.addResponseInterceptor(loggingResponseInterceptor); // 로깅은 마지막

export { api };
