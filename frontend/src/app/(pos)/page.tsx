import { getMenus } from "@/lib/server-api";
import POSClientShell from "@/components/pos/POSClientShell";
import type { MenuItem } from "@/types/menu";

export default async function POSPage() {
  let menus: MenuItem[];
  try {
    menus = await getMenus();
  } catch {
    menus = [];
  }

  return <POSClientShell initialMenus={menus} />;
}
