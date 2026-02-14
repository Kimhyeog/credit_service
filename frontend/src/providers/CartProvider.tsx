"use client";

import { createContext, useContext, useReducer, ReactNode } from "react";
import { MenuItem } from "@/types/menu";
import type { OrderMode } from "@/types/order";

// ─── 타입 정의 ───

export interface CartItem {
  menu: MenuItem;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  totalAmount: number;
  orderMode: OrderMode;    // 매장/포장
}

type CartAction =
  | { type: "ADD_ITEM"; menu: MenuItem }
  | { type: "REMOVE_ITEM"; menuId: string }
  | { type: "UPDATE_QUANTITY"; menuId: string; quantity: number }
  | { type: "SET_ORDER_MODE"; mode: OrderMode }
  | { type: "CLEAR" };

// ─── Reducer ───

function calcTotal(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.menu.price * i.quantity, 0);
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existing = state.items.find((i) => i.menu.id === action.menu.id);
      const items = existing
        ? state.items.map((i) =>
            i.menu.id === action.menu.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          )
        : [...state.items, { menu: action.menu, quantity: 1 }];
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "REMOVE_ITEM": {
      const items = state.items.filter((i) => i.menu.id !== action.menuId);
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "UPDATE_QUANTITY": {
      if (action.quantity <= 0) {
        return cartReducer(state, {
          type: "REMOVE_ITEM",
          menuId: action.menuId,
        });
      }
      const items = state.items.map((i) =>
        i.menu.id === action.menuId ? { ...i, quantity: action.quantity } : i
      );
      return { ...state, items, totalAmount: calcTotal(items) };
    }
    case "SET_ORDER_MODE":
      return { ...state, orderMode: action.mode };
    case "CLEAR":
      return { ...state, items: [], totalAmount: 0 };
    default:
      return state;
  }
}

// ─── Context & Provider ───

const CartContext = createContext<{
  state: CartState;
  dispatch: React.Dispatch<CartAction>;
} | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, {
    items: [],
    totalAmount: 0,
    orderMode: "DINE_IN",
  });

  return (
    <CartContext.Provider value={{ state, dispatch }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
