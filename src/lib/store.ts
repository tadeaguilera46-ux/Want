export type MenuCategory = "starters" | "mains" | "desserts" | "drinks";

export interface MenuItem {
  id: string;
  name: string;
  price: number;
  image: string;
  category: MenuCategory;
  description: string;
  observacion?: string;
  tags?: string[];
}

export interface CartItem extends MenuItem {
  quantity: number;
}

export interface Order {
  id: string;
  table: number;
  items: CartItem[];
  status: "pending" | "preparing" | "ready" | "delivered";
  type: "food" | "drink" | "mixed";
  time: string;
  total: number;
}

export interface BillRequest {
  id: string;
  table: number;
  total: number;
  paymentMethod: string;
  time: string;
  status: "pending" | "going" | "paid";
}

export const menuItems: MenuItem[] = [
  {
    id: "1",
    name: "Burrata Bruschetta",
    price: 8500,
    image: "public/menu/burrata-bruschetta.webp",
    category: "starters",
    description: "Pan artesanal tostado con burrata, tomate fresco y albahaca",
  },
  {
    id: "2",
    name: "Caesar Salad",
    price: 10000,
    image: "public/menu/caesar-crispy.webp",
    category: "starters",
    description: "Lechuga romana, pollo crocante, parmesano y croutons",
  },
  {
    id: "3",
    name: "Sopa del día",
    price: 7000,
    image: "public/menu/sopa-del-dia.webp",
    category: "starters",
    description: "Consultá la opción del día, preparada en el momento",
  },
  {
    id: "4",
    name: "Salmón grillado",
    price: 22000,
    image: "public/menu/salmon-grillado.webp",
    category: "mains",
    description: "Salmón con vegetales asados y manteca de limón",
  },
  {
    id: "5",
    name: "Bife de chorizo",
    price: 28000,
    image: "public/menu/bife-chorizo.webp",
    category: "mains",
    description: "Corte premium con papas crocantes y ensalada",
  },
  {
    id: "6",
    name: "Risotto de hongos",
    price: 16000,
    image: "public/menu/risotto-hongos.webp",
    category: "mains",
    description: "Arroz cremoso con mix de hongos y parmesano",
  },
  {
    id: "7",
    name: "Pasta Carbonara",
    price: 14500,
    image: "public/menu/pasta-carbonara.webp",
    category: "mains",
    description: "Receta clásica italiana con panceta y pimienta negra",
  },
  {
    id: "8",
    name: "Chicken Burger",
    price: 15000,
    image: "public/menu/chicken-burger.webp",
    category: "mains",
    description: "Pollo crocante, lechuga y salsa especial",
  },
  {
    id: "9",
    name: "Tiramisú",
    price: 9000,
    image: "public/menu/tiramisu.webp",
    category: "desserts",
    description: "Postre italiano con café, cacao y crema",
  },
  {
    id: "10",
    name: "Torta de chocolate",
    price: 8500,
    image: "public/menu/chocolate-cake.webp",
    category: "desserts",
    description: "Torta húmeda con cobertura intensa de chocolate",
  },
  {
    id: "11",
    name: "Helado artesanal",
    price: 6000,
    image: "public/menu/helado-artesanal.webp",
    category: "desserts",
    description: "3 bochas a elección",
  },
  {
    id: "12",
    name: "Coca-Cola",
    price: 3500,
    image: "public/menu/coca-cola.webp",
    category: "drinks",
    description: "Bebida gaseosa 330ml",
  },
  {
    id: "13",
    name: "Jugo natural",
    price: 5000,
    image: "public/menu/jugo-natural.webp",
    category: "drinks",
    description: "Exprimido fresco de frutas",
  },
  {
    id: "14",
    name: "Cerveza tirada",
    price: 5500,
    image: "public/menu/cerveza-tirada.webp",
    category: "drinks",
    description: "Pinta fría artesanal",
  },
  {
    id: "15",
    name: "Vino tinto",
    price: 7000,
    image: "public/menu/copa-vino-tinto.webp",
    category: "drinks",
    description: "Copa de vino de la casa",
  },
  {
    id: "16",
    name: "Margarita",
    price: 11000,
    image: "public/menu/margarita.webp",
    category: "drinks",
    description: "Cocktail clásico con lima y sal",
  },
  {
    id: "17",
    name: "Agua mineral",
    price: 2000,
    image: "public/menu/agua-mineral.webp",
    category: "drinks",
    description: "Con o sin gas",
  },
];

export const sampleOrders: Order[] = [
  {
    id: "ORD-001",
    table: 5,
    items: [
      { ...menuItems[3], quantity: 2 },
      { ...menuItems[6], quantity: 1, observacion: "Sin queso" },
    ],
    status: "pending",
    type: "food",
    time: "12:34",
    total: 53800,
  },
  {
    id: "ORD-002",
    table: 3,
    items: [
      { ...menuItems[4], quantity: 1, observacion: "Punto medio" },
      { ...menuItems[1], quantity: 2 },
    ],
    status: "preparing",
    type: "food",
    time: "12:28",
    total: 44100,
  },
  {
    id: "ORD-003",
    table: 8,
    items: [
      { ...menuItems[13], quantity: 3, observacion: "Sin hielo" },
      { ...menuItems[15], quantity: 2 },
    ],
    status: "pending",
    type: "drink",
    time: "12:36",
    total: 33900,
  },
  {
    id: "ORD-004",
    table: 1,
    items: [
      { ...menuItems[14], quantity: 2 },
      { ...menuItems[12], quantity: 1 },
    ],
    status: "ready",
    type: "drink",
    time: "12:20",
    total: 17000,
  },
  {
    id: "ORD-005",
    table: 12,
    items: [
      { ...menuItems[5], quantity: 1, observacion: "Bien cocido" },
      { ...menuItems[0], quantity: 2, observacion: "Sin ajo" },
    ],
    status: "ready",
    type: "food",
    time: "12:15",
    total: 41500,
  },
];

export const sampleBillRequests: BillRequest[] = [
  {
    id: "BILL-001",
    table: 7,
    total: 65500,
    paymentMethod: "Credit Card",
    time: "12:40",
    status: "pending",
  },
  {
    id: "BILL-002",
    table: 2,
    total: 43000,
    paymentMethod: "Cash",
    time: "12:38",
    status: "pending",
  },
  {
    id: "BILL-003",
    table: 10,
    total: 89000,
    paymentMethod: "Debit Card",
    time: "12:35",
    status: "going",
  },
];