/** 키오스크/테이블오더 관련 타입 */

/** 키오스크 주문 단계 */
export type KioskStep = "MENU_SELECT" | "CART_REVIEW" | "ORDER_CONFIRM";
// "MENU_SELECT" : 메뉴 선택 단계
// "CART_REVIEW" : 장바구니 확인 단계
// "ORDER_CONFIRM" : 주문 확인 단계

/** 테이블 정보 */
export interface TableInfo {
  tableId: string;
  tableName: string; // "테이블 1", "테이블 2" 등
  capacity?: number;
}
