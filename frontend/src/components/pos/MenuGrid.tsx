"use client";

import { useState, useMemo } from "react";
import styled from "@emotion/styled";
import { useCart } from "@/providers/CartProvider";
import CategoryTabs from "@/components/common/CategoryTabs";
import MenuItem from "./MenuItem";
import type { MenuItem as MenuItemType } from "@/types/menu";

interface MenuGridProps {
  menus: MenuItemType[];
}

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: ${({ theme }) => theme.spacing.md};
  padding: ${({ theme }) => theme.spacing.md};
`;

const LoadingText = styled.p`
  padding: ${({ theme }) => theme.spacing.lg};
  color: ${({ theme }) => theme.colors.text.secondary};
  text-align: center;
`;

export default function MenuGrid({ menus }: MenuGridProps) {
  const { dispatch } = useCart();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // 카테고리 목록 추출
  const categories = useMemo(() => {
    const cats = new Set(menus.map((m) => m.category));
    return Array.from(cats);
  }, [menus]);

  // 선택된 카테고리의 메뉴만 필터링
  const filteredMenus = useMemo(() => {
    if (activeCategory === null) return menus;
    return menus.filter((m) => m.category === activeCategory);
  }, [menus, activeCategory]);

  const handleMenuClick = (menu: MenuItemType) => {
    dispatch({ type: "ADD_ITEM", menu });
  };

  if (!menus || menus.length === 0) {
    return <LoadingText>등록된 메뉴가 없습니다.</LoadingText>;
  }

  return (
    <div>
      <CategoryTabs
        categories={categories}
        activeCategory={activeCategory}
        onSelect={setActiveCategory}
        showFavorites={true}
      />
      <Grid>
        {filteredMenus.map((menu) => (
          <MenuItem key={menu.id} menu={menu} onClick={handleMenuClick} />
        ))}
      </Grid>
    </div>
  );
}
