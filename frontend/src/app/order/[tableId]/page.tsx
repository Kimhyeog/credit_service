import { getMenus } from "@/lib/server-api";
import TableOrderShell from "@/components/order/TableOrderShell";
import type { MenuItem } from "@/types/menu";

export default async function TableOrderPage({
  params,
}: {
  params: Promise<{ tableId: string }>;
}) {
  const { tableId } = await params;

  let menus: MenuItem[];
  try {
    menus = await getMenus();
  } catch {
    menus = [];
  }

  return <TableOrderShell tableId={tableId} initialMenus={menus} />;
}
