import {
  HomeOutline,
  CartOutline,
  CubeOutline,
  CloudUploadOutline,
  LayersOutline,
  BarcodeOutline,
  BusinessOutline,
  ReceiptOutline,
  SettingsOutline,
  PeopleOutline,
  PricetagOutline,
} from "@vicons/ionicons5";

export const NAV_ITEMS = [
  { label: "Dashboard", key: "dashboard", icon: HomeOutline, adminOnly: true },
  { label: "POS / New Sale", key: "pos", icon: CartOutline, adminOnly: false },
  { label: "Products", key: "products", icon: CubeOutline, adminOnly: false },
  { label: "Price groups", key: "price-groups", icon: PricetagOutline, adminOnly: true },
  { label: "Import Products", key: "import", icon: CloudUploadOutline, adminOnly: true },
  { label: "Inventory", key: "inventory", icon: LayersOutline, adminOnly: true },
  { label: "Barcode Printing", key: "barcodes", icon: BarcodeOutline, adminOnly: true },
  { label: "Vendors", key: "vendors", icon: BusinessOutline, adminOnly: true },
  { label: "Sales History", key: "sales", icon: ReceiptOutline, adminOnly: true },
  { label: "Staff users", key: "staff", icon: PeopleOutline, adminOnly: true },
  { label: "Settings", key: "settings", icon: SettingsOutline, adminOnly: true },
];

export const ADMIN_ONLY_ROUTES = new Set(
  NAV_ITEMS.filter((i) => i.adminOnly).map((i) => i.key)
);

export function visibleNavItems(isAdmin) {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);
}

export function navRouteKeysForUser(isAdmin) {
  return visibleNavItems(isAdmin).map((item) => item.key);
}
