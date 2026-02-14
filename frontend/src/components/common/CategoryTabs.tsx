"use client";

import styled from "@emotion/styled";

interface CategoryTabsProps {
  categories: string[];
  activeCategory: string | null;
  onSelect: (category: string | null) => void;
  showFavorites?: boolean;
}

const TabBar = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing.sm};
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const Tab = styled.button<{ isActive: boolean }>`
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  font-size: ${({ theme }) => theme.fontSize.sm};
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.15s;

  ${({ isActive, theme }) =>
    isActive
      ? `
        background: ${theme.colors.primary};
        color: white;
      `
      : `
        background: ${theme.colors.surface};
        color: ${theme.colors.text.secondary};
        &:hover {
          background: ${theme.colors.surfaceHover};
        }
      `}
`;

export default function CategoryTabs({
  categories,
  activeCategory,
  onSelect,
  showFavorites = false,
}: CategoryTabsProps) {
  return (
    <TabBar>
      {showFavorites && (
        <Tab
          isActive={activeCategory === null}
          onClick={() => onSelect(null)}
        >
          ★ 즐겨찾기
        </Tab>
      )}
      {!showFavorites && (
        <Tab
          isActive={activeCategory === null}
          onClick={() => onSelect(null)}
        >
          전체
        </Tab>
      )}
      {categories.map((cat) => (
        <Tab
          key={cat}
          isActive={activeCategory === cat}
          onClick={() => onSelect(cat)}
        >
          {cat}
        </Tab>
      ))}
    </TabBar>
  );
}
