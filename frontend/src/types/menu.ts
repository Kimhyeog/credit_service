export interface MenuItem {
  id: string;
  name: string;
  price: number; // 원 단위 (Int)
  category: string;
  imageUrl: string | null;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
}
