"use client";

import Link from "next/link";
import styled from "@emotion/styled";
import { useMenus } from "@/hooks/useMenus";
import { useRecovery } from "@/hooks/useRecovery";
import MenuGrid from "./MenuGrid";
import Cart from "./Cart";
import RecoveryBanner from "@/components/payment/RecoveryBanner";
import OfflineBanner from "@/components/common/OfflineBanner";
import ThemeToggle from "@/components/common/ThemeToggle";
import type { MenuItem } from "@/types/menu";

interface POSClientShellProps {
  initialMenus: MenuItem[];
}

const PageLayout = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
`;

const MenuSection = styled.main`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const CartSection = styled.aside`
  width: 360px;
  flex-shrink: 0;
`;

const TopBar = styled.header`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: ${({ theme }) => `${theme.spacing.sm} ${theme.spacing.md}`};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Logo = styled.h1`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: ${({ theme }) => theme.fontSize.xl};
  font-weight: 700;
  color: ${({ theme }) => theme.colors.primary};
`;

const LogoIcon = styled.img`
  width: 28px;
  height: 28px;
`;

const TopBarActions = styled.div`
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

const MenuArea = styled.div`
  flex: 1;
  overflow-y: auto;
`;

export default function POSClientShell({ initialMenus }: POSClientShellProps) {
  const { data: menus } = useMenus(initialMenus);
  const { isRecovering, recoveredCount, needsManualCount, dismiss } =
    useRecovery();

  return (
    <PageLayout>
      <OfflineBanner />
      <MenuSection>
        {!isRecovering &&
          (recoveredCount > 0 || needsManualCount > 0) && (
            <RecoveryBanner
              recoveredCount={recoveredCount}
              needsManualCount={needsManualCount}
              onDismiss={dismiss}
            />
          )}
        <TopBar>
          <Logo>
            <LogoIcon src="/Toss_App_Icon.svg" alt="Toss" />
            Toss-Sync POS
          </Logo>
          <TopBarActions>
            <NavLink href="/kiosk">키오스크</NavLink>
            <NavLink href="/admin/orders">KDS</NavLink>
            <ThemeToggle />
          </TopBarActions>
        </TopBar>
        <MenuArea>
          <MenuGrid menus={menus ?? []} />
        </MenuArea>
      </MenuSection>
      <CartSection>
        <Cart />
      </CartSection>
    </PageLayout>
  );
}
