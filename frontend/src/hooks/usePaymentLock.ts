const LOCK_KEY = "toss_sync_pos_payment_lock";
const LOCK_TTL_MS = 5 * 60 * 1000; // 5분

interface LockData {
  lockedAt: number;
  tabId: string;
}

// 탭별 고유 ID (페이지 로드마다 생성)
const TAB_ID = crypto.randomUUID();

/** 잠금 획득 — 성공 시 true, 이미 다른 탭에서 잠금 중이면 false */
export function acquireLock(): boolean {
  const raw = localStorage.getItem(LOCK_KEY);

  if (raw) {
    try {
      const lock: LockData = JSON.parse(raw);
      const elapsed = Date.now() - lock.lockedAt;

      // 같은 탭이면 이미 잠금 소유
      if (lock.tabId === TAB_ID) return true;

      // 다른 탭이고 TTL 미만 → 잠금 실패
      if (elapsed < LOCK_TTL_MS) return false;

      // TTL 초과 → 만료된 잠금, 새로 획득
    } catch {
      // 파싱 실패 → 새로 획득
    }
  }

  localStorage.setItem(
    LOCK_KEY,
    JSON.stringify({ lockedAt: Date.now(), tabId: TAB_ID } satisfies LockData),
  );
  return true;
}

/** 잠금 해제 (자신의 잠금만 해제) */
export function releaseLock(): void {
  const raw = localStorage.getItem(LOCK_KEY);
  if (!raw) return;

  try {
    const lock: LockData = JSON.parse(raw);
    if (lock.tabId === TAB_ID) {
      localStorage.removeItem(LOCK_KEY);
    }
  } catch {
    localStorage.removeItem(LOCK_KEY);
  }
}

/** 강제 잠금 해제 — 결제 완료/실패 리다이렉트 페이지에서 사용 (TAB_ID 무관) */
export function forceReleaseLock(): void {
  localStorage.removeItem(LOCK_KEY);
}

/** 현재 잠금 상태 확인 */
export function isLocked(): boolean {
  const raw = localStorage.getItem(LOCK_KEY);
  if (!raw) return false;

  try {
    const lock: LockData = JSON.parse(raw);
    return Date.now() - lock.lockedAt < LOCK_TTL_MS;
  } catch {
    return false;
  }
}
