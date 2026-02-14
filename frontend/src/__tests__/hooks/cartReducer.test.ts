import { describe, it, expect } from "vitest";
import { cartReducer } from "@/providers/CartProvider";

const MENU_A = {
  id: "a",
  name: "아메리카노",
  price: 4500,
  category: "커피",
  isAvailable: true,
};
const MENU_B = {
  id: "b",
  name: "라떼",
  price: 5500,
  category: "커피",
  isAvailable: true,
};

const EMPTY = {
  items: [],
  totalAmount: 0,
  orderMode: "DINE_IN" as const,
};

describe("cartReducer", () => {
  it("ADD_ITEM — 새 아이템 추가", () => {
    const state = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(1);
    expect(state.totalAmount).toBe(4500);
  });

  it("ADD_ITEM — 기존 아이템 수량 +1", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "ADD_ITEM", menu: MENU_A });
    expect(s2.items).toHaveLength(1);
    expect(s2.items[0].quantity).toBe(2);
    expect(s2.totalAmount).toBe(9000);
  });

  it("REMOVE_ITEM", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, { type: "REMOVE_ITEM", menuId: "a" });
    expect(s2.items).toHaveLength(0);
    expect(s2.totalAmount).toBe(0);
  });

  it("UPDATE_QUANTITY — 수량 변경", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, {
      type: "UPDATE_QUANTITY",
      menuId: "a",
      quantity: 5,
    });
    expect(s2.items[0].quantity).toBe(5);
    expect(s2.totalAmount).toBe(22500);
  });

  it("UPDATE_QUANTITY — 0 이하 시 삭제", () => {
    const s1 = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    const s2 = cartReducer(s1, {
      type: "UPDATE_QUANTITY",
      menuId: "a",
      quantity: 0,
    });
    expect(s2.items).toHaveLength(0);
    expect(s2.totalAmount).toBe(0);
  });

  it("CLEAR — 전체 초기화", () => {
    let s = cartReducer(EMPTY, { type: "ADD_ITEM", menu: MENU_A });
    s = cartReducer(s, { type: "ADD_ITEM", menu: MENU_B });
    s = cartReducer(s, { type: "CLEAR" });
    expect(s.items).toHaveLength(0);
    expect(s.totalAmount).toBe(0);
  });
});
