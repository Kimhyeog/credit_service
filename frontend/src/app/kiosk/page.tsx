import { getMenus } from "@/lib/server-api";
import KioskShell from "@/components/kiosk/KioskShell";
import type { MenuItem } from "@/types/menu";

export default async function KioskPage() {
  let menus: MenuItem[];
  try {
    menus = await getMenus();
  } catch {
    menus = [];
  }

  return <KioskShell initialMenus={menus} />;
}
