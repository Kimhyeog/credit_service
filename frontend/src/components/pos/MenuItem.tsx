"use client";

import styled from "@emotion/styled";
import { useTheme } from "@emotion/react";
import type { MenuItem as MenuItemType } from "@/types/menu";

interface MenuItemProps {
  menu: MenuItemType;
  onClick: (menu: MenuItemType) => void;
}

/** 카테고리에 따른 테마 색상 키 반환 */
function getCategoryColorKey(category: string): "coffee" | "beverage" | "bakery" | "default" {
  const lower = category.toLowerCase();
  if (lower === "커피" || lower === "coffee") return "coffee";
  if (lower === "음료" || lower === "beverage") return "beverage";
  if (lower === "베이커리" || lower === "bakery") return "bakery";
  return "default";
}

const Card = styled.button<{ categoryColor: string }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => theme.spacing.md};
  background: ${({ theme }) => theme.colors.surface};
  border-radius: ${({ theme }) => theme.borderRadius.md};
  transition: background-color 0.15s, transform 0.1s;
  text-align: center;
  min-height: 120px;
  position: relative;

  /* 카테고리 색상 상단 바 */
  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: ${({ categoryColor }) => categoryColor};
    border-radius: ${({ theme }) => `${theme.borderRadius.md} ${theme.borderRadius.md} 0 0`};
  }

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
    transform: translateY(-2px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const MenuName = styled.span`
  font-size: ${({ theme }) => theme.fontSize.md};
  font-weight: 600;
  color: ${({ theme }) => theme.colors.text.primary};
`;

const MenuPrice = styled.span`
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
`;

const MenuCategory = styled.span<{ categoryColor: string }>`
  font-size: ${({ theme }) => theme.fontSize.xs};
  color: ${({ categoryColor }) => categoryColor};
  background: ${({ categoryColor }) => `${categoryColor}15`};
  padding: 2px 8px;
  border-radius: 4px;
`;

export default function MenuItem({ menu, onClick }: MenuItemProps) {
  const theme = useTheme();
  const colorKey = getCategoryColorKey(menu.category);
  const categoryColor = theme.colors.category[colorKey];

  return (
    <Card onClick={() => onClick(menu)} categoryColor={categoryColor}>
      <MenuCategory categoryColor={categoryColor}>{menu.category}</MenuCategory>
      <MenuName>{menu.name}</MenuName>
      <MenuPrice>{menu.price.toLocaleString()}원</MenuPrice>
    </Card>
  );
}
