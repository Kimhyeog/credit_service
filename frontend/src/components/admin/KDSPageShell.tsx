"use client";

import Link from "next/link";
import styled from "@emotion/styled";
import { useOrders } from "@/hooks/useOrders";
import KDSBoard from "./KDSBoard";
import ThemeToggle from "@/components/common/ThemeToggle";

const Layout = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.background};
`;

const TopBar = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Logo = styled.h1`
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
`;

const NavActions = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NavLink = styled(Link)`
  padding: ${({ theme }) => `${theme.spacing.xs} ${theme.spacing.sm}`};
  font-size: ${({ theme }) => theme.fontSize.sm};
  color: ${({ theme }) => theme.colors.text.secondary};
  border-radius: ${({ theme }) => theme.borderRadius.sm};
  transition: background-color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.surfaceHover};
  }
`;

const BoardArea = styled.div`
  flex: 1;
  padding: ${({ theme }) => theme.spacing.md};
  overflow: hidden;
`;

export default function KDSPageShell() {
  const { data: orders = [] } = useOrders();

  return (
    <Layout>
      <TopBar>
        <Logo>주문현황 (KDS)</Logo>
        <NavActions>
          <NavLink href="/admin">대시보드</NavLink>
          <NavLink href="/">POS</NavLink>
          <ThemeToggle />
        </NavActions>
      </TopBar>

      <BoardArea>
        <KDSBoard orders={orders} />
      </BoardArea>
    </Layout>
  );
}
