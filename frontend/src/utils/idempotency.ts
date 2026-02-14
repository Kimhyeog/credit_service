/**
 * 멱등성 키 생성
 *
 * 포맷: pos_{hash}_{timestamp}_{random}
 * - hash: 장바구니 내용의 djb2 해시 (같은 내용 → 같은 해시)
 * - timestamp: 초 단위 유닉스 시간
 * - random: UUID 앞 8자리 (충돌 방지)
 */
export function generateIdempotencyKey(
  items: { menuId: string; quantity: number }[]
): string {
  const payload = items
    .map((i) => `${i.menuId}:${i.quantity}`)
    .sort()
    .join("|");
  const timestamp = Math.floor(Date.now() / 1000);
  const random = crypto.randomUUID().slice(0, 8);
  return `pos_${simpleHash(payload)}_${timestamp}_${random}`;
}

/** djb2 해시 — 간단한 핑거프린팅용 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
