import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { toast } from "sonner";
import {
  AlertTriangle,
  BarChart3,
  FileText,
  LogOut,
  Plus,
  Printer,
  Receipt,
  Trash2,
  Wallet,
  X,
  Users,
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { getDb } from "../lib/firebase";
import { useAuth } from "../lib/auth-context";
import { useRestaurant } from "../lib/restaurant-context";
import { crearPedido } from "../lib/orders";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  addPartialPayment,
  createCashierAuditLog,
  createOrRefreshCashierBill,
  markCashierBillPrinted,
  reopenCashierBill,
  requestCashierInvoice,
  unlockSessionForCashierAdd,
  updateCashierBillAdjustments,
} from "../lib/cashier";
import type { MetodoPago, PedidoItem } from "../lib/restaurant";
import type {
  CashierDiscountType,
  CashierPaymentMethod,
} from "../types/cashier";
import {
  calcTwoForOneDiscount,
  type TwoForOnePromo,
} from "../lib/promotions";
import { writeAuditLog } from "../lib/audit-logs";

const db = getDb();

type MenuType = "food" | "drinks";

type Session = {
  id: string;
  status?: "active" | "closed";
};

type MenuItem = {
  id: string;
  name: string;
  price: number;
  type?: MenuType;
  category: string;
  active: boolean;
  image?: string;
  description?: string;
  ingredients?: unknown[];
};

type Cuenta = {
  id: string;
  restaurantId: string;
  mesa: number;
  sessionId?: string;
  total: number;
  estado: string;
  metodo?: MetodoPago | null;
  splitBill?: boolean;
  discountType?: CashierDiscountType;
  discountValue?: number;
  discountReason?: string;
  manualExtraAmount?: number;
  manualExtraReason?: string;
  paidAmount?: number;
  tip?: number;
  unpaid?: boolean;
  unpaidReason?: string;
  internalNote?: string;
  payments?: {
    id: string;
    method: CashierPaymentMethod;
    amount: number;
    note?: string;
  }[];
  invoice?: {
    status?: string;
    type?: "A" | "B" | "C" | "ticket";
    customerName?: string;
    documentType?: "DNI" | "CUIT" | "CUIL" | "PASSPORT";
    documentNumber?: string;
    ivaCondition?: string;
    fiscalRegime?: string;
    fiscalAddress?: string;
    postalCode?: string;
    province?: string;
    city?: string;
    email?: string;
    cae?: string;
    caeExpiry?: string;
    invoiceNumber?: number;
    invoiceType?: string;
    puntoVenta?: number;
  };
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
};

type CancelledItem = {
  itemIndex: number;
  name: string;
  reason: string;
  cancelledAt: number;
};

type Pedido = {
  id: string;
  restaurantId: string;
  mesa: number;
  sessionId?: string;
  total: number;
  items: CashierOrderItem[];
  cancelledItems?: CancelledItem[];
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
};

type CashierOrderItem = PedidoItem & {
  id?: string;
  name?: string;
  quantity?: number;
  precio?: number;
  price?: number;
  subtotal?: number;
  displayCategory?: string;
  note?: string;
};

type DraftManualItem = {
  menuItem: MenuItem;
  quantity: number;
};

type CashAdjustment = {
  id: string;
  type: "add" | "deduct";
  amount: number;
  reason: string;
  createdAt: number;
};

const formatPriceARS = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value || 0);

const getTimestampMs = (value?: Cuenta["createdAt"] | Pedido["createdAt"]) => {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
};

const getItemName = (item: CashierOrderItem) =>
  item.nombre || item.name || "Producto";

const getItemQuantity = (item: CashierOrderItem) =>
  Number(item.cantidad || item.quantity || 1);

const getItemPrice = (item: CashierOrderItem) =>
  Number(item.precio || item.price || 0);

const getItemSubtotal = (item: CashierOrderItem) => {
  const subtotal = Number(item.subtotal || 0);
  if (Number.isFinite(subtotal) && subtotal > 0) return subtotal;
  return getItemPrice(item) * getItemQuantity(item);
};

const getMenuItemType = (item: MenuItem): MenuType => {
  if (item.type === "drinks") return "drinks";
  return "food";
};

const paymentLabels: Record<CashierPaymentMethod, string> = {
  cash: "Efectivo",
  debit: "Débito",
  credit: "Crédito",
  transfer: "Transferencia",
  mercado_pago: "Mercado Pago",
  mixed: "Mixto",
  other: "Otro",
};

const cashierMethodToMetodoPago = (
  method: CashierPaymentMethod
): MetodoPago | null => {
  if (
    method === "cash" ||
    method === "debit" ||
    method === "credit" ||
    method === "transfer"
  ) {
    return method;
  }

  return null;
};

function validateCuit(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * parseInt(digits[i], 10), 0);
  const remainder = 11 - (sum % 11);
  const check = remainder === 11 ? 0 : remainder;
  return check !== 10 && check === parseInt(digits[10], 10);
}

const BILL_WARN_MINUTES = 30;
const BILL_DANGER_MINUTES = 60;

const Cashier = () => {
  const [searchParams] = useSearchParams();
  const { restaurantId: contextRestaurantId, restaurant } = useRestaurant();
  const { user, logout } = useAuth();
  const isOnline = useOnlineStatus();

  const restaurantId =
    contextRestaurantId || searchParams.get("restaurantId") || "";

  const invoiceRequestsPath = `/staff/cashier/invoices?restaurantId=${encodeURIComponent(
    restaurantId
  )}`;
  const waitlistPath = `/staff/waitlist?restaurantId=${encodeURIComponent(
    restaurantId
  )}`;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [orders, setOrders] = useState<Pedido[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [twoForOnePromos, setTwoForOnePromos] = useState<TwoForOnePromo[]>([]);

  const [selectedCuentaId, setSelectedCuentaId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [discountType, setDiscountType] =
    useState<CashierDiscountType>("none");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [manualExtraAmount, setManualExtraAmount] = useState("");
  const [manualExtraReason, setManualExtraReason] = useState("");
  const [internalNote, setInternalNote] = useState("");

  const [paymentMethod, setPaymentMethod] =
    useState<CashierPaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [cashReceived, setCashReceived] = useState("");
  const [tipAmount, setTipAmount] = useState("");

  const [manualMesa, setManualMesa] = useState("");
  const [manualSelectedMenuId, setManualSelectedMenuId] = useState("");
  const [manualQuantity, setManualQuantity] = useState("1");
  const [manualItems, setManualItems] = useState<DraftManualItem[]>([]);

  const [addSelectedMenuId, setAddSelectedMenuId] = useState("");
  const [addQuantity, setAddQuantity] = useState("1");

  const [invoiceType, setInvoiceType] =
    useState<"A" | "B" | "C" | "ticket">("B");
  const [invoiceCustomerName, setInvoiceCustomerName] = useState("");
  const [invoiceDocumentType, setInvoiceDocumentType] =
    useState<"DNI" | "CUIT" | "CUIL" | "PASSPORT">("DNI");
  const [invoiceDocumentNumber, setInvoiceDocumentNumber] = useState("");
  const cuitError =
    invoiceDocumentType === "CUIT" &&
    invoiceDocumentNumber.trim().length > 0 &&
    !validateCuit(invoiceDocumentNumber);
  const [invoiceEmail, setInvoiceEmail] = useState("");
  const [invoiceIvaCondition, setInvoiceIvaCondition] = useState("");
  const [invoiceFiscalRegime, setInvoiceFiscalRegime] = useState("");
  const [invoiceFiscalAddress, setInvoiceFiscalAddress] = useState("");
  const [invoicePostalCode, setInvoicePostalCode] = useState("");
  const [invoiceProvince, setInvoiceProvince] = useState("");
  const [invoiceCity, setInvoiceCity] = useState("");

  const [reopenReason, setReopenReason] = useState("");
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [showInvoiceInline, setShowInvoiceInline] = useState(false);
  const [showSplitBill, setShowSplitBill] = useState(false);
  const [splitParts, setSplitParts] = useState("2");
  const [splitMode, setSplitMode] = useState<"partes" | "productos">("partes");
  const [splitProductSelection, setSplitProductSelection] = useState<Record<string, boolean>>({});
  const [splitPaidKeys, setSplitPaidKeys] = useState<Record<string, true>>({});
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showDiscountAccordion, setShowDiscountAccordion] = useState(false);
  const [showNotaAccordion, setShowNotaAccordion] = useState(false);
  const [cancelItemTarget, setCancelItemTarget] = useState<{ pedidoId: string; itemIndex: number; name: string } | null>(null);
  const [cancelItemReason, setCancelItemReason] = useState("");

  const [compactMode, setCompactMode] = useState(false);

  const [showOpeningDialog, setShowOpeningDialog] = useState(true);
  const [openingCaja, setOpeningCaja] = useState(false);
  const [openingCashInput, setOpeningCashInput] = useState("");
  const markPaidLockRef = useRef(false);
  const [cashSession, setCashSession] = useState<{
    openingCash: number;
    openedAt: number;
    adjustments?: CashAdjustment[];
  } | null>(null);
  const [showCierreModal, setShowCierreModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [adjustForm, setAdjustForm] = useState<{
    type: "add" | "deduct";
    amount: string;
    reason: string;
  } | null>(null);
  const [closingCaja, setClosingCaja] = useState(false);
  const [cajaTurnoId, setCajaTurnoId] = useState<string | null>(null);
  const [cajaArqueoRealInput, setCajaArqueoRealInput] = useState("");

  const sessionKey = restaurantId && user?.uid
    ? `cashier_session_${restaurantId}_${user.uid}_${new Date().toISOString().slice(0, 10)}`
    : null;

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "sessions"),
      where("status", "==", "active"),
      limit(100)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Session[];

      setSessions(data);
    });

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;
    return onSnapshot(
      collection(db, "restaurants", restaurantId, "promotions2x1"),
      (snap) =>
        setTwoForOnePromos(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TwoForOnePromo)
        )
    );
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "cuentas"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as Cuenta[];

        setCuentas(data);
        setLoading(false);
      },
      (err) => {
        console.error("Error cargando cuentas:", err);
        setError("No se pudieron cargar las cuentas.");
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "pedidos"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as Pedido[];

      setOrders(data);
    });

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(
      collection(db, "restaurants", restaurantId, "menu"),
      where("active", "==", true)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data(),
      })) as MenuItem[];

      setMenuItems(data.sort((a, b) => a.name.localeCompare(b.name)));
    });

    return () => unsubscribe();
  }, [restaurantId]);

  // Restore cash session — Firestore first, localStorage as fallback
  useEffect(() => {
    if (!restaurantId || !user?.uid || !sessionKey) return;
    const uid = user.uid;
    getDocs(
      query(
        collection(db, "restaurants", restaurantId, "cajaTurnos"),
        where("actorUid", "==", uid),
        where("status", "==", "open"),
        orderBy("openedAt", "desc"),
        limit(1)
      )
    )
      .then((snap) => {
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = d.data();
          setCajaTurnoId(d.id);
          setCashSession({
            openingCash: Number(data.openingCash ?? 0),
            openedAt: Number(data.openedAt ?? Date.now()),
            adjustments: Array.isArray(data.adjustments)
              ? (data.adjustments as CashAdjustment[])
              : [],
          });
          setShowOpeningDialog(false);
        } else {
          const stored = localStorage.getItem(sessionKey);
          if (stored) {
            try { setCashSession(JSON.parse(stored) as typeof cashSession); } catch { /* ignore */ }
          }
        }
      })
      .catch(() => {
        const stored = localStorage.getItem(sessionKey);
        if (stored) {
          try { setCashSession(JSON.parse(stored) as typeof cashSession); } catch { /* ignore */ }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey]);

  const activeSessionIds = useMemo(() => {
    return new Set(
      sessions
        .filter((session) => session.status === "active")
        .map((session) => session.id)
    );
  }, [sessions]);

  const activeBills = useMemo(() => {
    return cuentas.filter((cuenta) => {
      if (cuenta.sessionId) return activeSessionIds.has(cuenta.sessionId);
      return cuenta.estado !== "cerrada";
    });
  }, [cuentas, activeSessionIds]);

  const pendingBills = useMemo(() => {
    return activeBills.filter(
      (cuenta) => cuenta.estado !== "pagada" && cuenta.estado !== "cerrada"
    );
  }, [activeBills]);

  const [billsNow, setBillsNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setBillsNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const getBillAgeMinutes = (cuenta: Cuenta) => {
    const ts = getTimestampMs(cuenta.createdAt);
    if (!ts) return 0;
    return Math.floor((billsNow - ts) / 60_000);
  };

  const stalePendingBills = useMemo(
    () =>
      pendingBills.filter((c) => {
        const ts = getTimestampMs(c.createdAt);
        return ts > 0 && billsNow - ts >= BILL_WARN_MINUTES * 60_000;
      }),
    [pendingBills, billsNow]
  );

  const invoiceRequestsCount = useMemo(() => {
    return cuentas.filter((cuenta) => cuenta.invoice?.status === "requested")
      .length;
  }, [cuentas]);

  const selectedCuenta = useMemo(() => {
    if (!selectedCuentaId) return null;
    return activeBills.find((cuenta) => cuenta.id === selectedCuentaId) || null;
  }, [activeBills, selectedCuentaId]);

  useEffect(() => {
    if (selectedCuentaId && !selectedCuenta) {
      setSelectedCuentaId(null);
    }
  }, [selectedCuentaId, selectedCuenta]);

  useEffect(() => {
    if (!selectedCuenta) return;

    setDiscountType(selectedCuenta.discountType || "none");
    setDiscountValue(String(selectedCuenta.discountValue || ""));
    setDiscountReason(selectedCuenta.discountReason || "");
    setManualExtraAmount(String(selectedCuenta.manualExtraAmount || ""));
    setManualExtraReason(selectedCuenta.manualExtraReason || "");
    setInternalNote(selectedCuenta.internalNote || "");

    setPaymentAmount(String(Number(selectedCuenta.total || 0)));
    setCashReceived("");
    setTipAmount("");
    setShowInvoiceInline(false);

    setInvoiceType(selectedCuenta.invoice?.type || "B");
    setInvoiceCustomerName(selectedCuenta.invoice?.customerName || "");
    setInvoiceDocumentType(selectedCuenta.invoice?.documentType || "DNI");
    setInvoiceDocumentNumber(selectedCuenta.invoice?.documentNumber || "");
    setInvoiceEmail(selectedCuenta.invoice?.email || "");
    setInvoiceIvaCondition(selectedCuenta.invoice?.ivaCondition || "");
    setInvoiceFiscalRegime(selectedCuenta.invoice?.fiscalRegime || "");
    setInvoiceFiscalAddress(selectedCuenta.invoice?.fiscalAddress || "");
    setInvoicePostalCode(selectedCuenta.invoice?.postalCode || "");
    setInvoiceProvince(selectedCuenta.invoice?.province || "");
    setInvoiceCity(selectedCuenta.invoice?.city || "");
    setSplitMode("partes");
    setSplitProductSelection({});
    setSplitPaidKeys({});
  }, [selectedCuenta?.id]);

  const selectedOrders = useMemo(() => {
    if (!selectedCuenta) return [];
    if (!selectedCuenta.sessionId) return [];

    return orders
      .filter((order) => {
        if (selectedCuenta.sessionId && order.sessionId) {
          return order.sessionId === selectedCuenta.sessionId;
        }

        return Number(order.mesa) === Number(selectedCuenta.mesa);
      })
      .sort((a, b) => getTimestampMs(a.createdAt) - getTimestampMs(b.createdAt));
  }, [orders, selectedCuenta]);

  const selectedItems = useMemo(() => {
    return selectedOrders.flatMap((order) =>
      (order.items || []).map((item, idx) => ({
        ...item,
        _pedidoId: order.id,
        _itemIndex: idx,
        _cancelled: order.cancelledItems?.some((c) => c.itemIndex === idx) ?? false,
      }))
    );
  }, [selectedOrders]);

  const realSubtotal = useMemo(() => {
    if (!selectedCuenta) return 0;

    const hasCancelledItems = selectedOrders.some((o) => (o.cancelledItems?.length ?? 0) > 0);
    if (hasCancelledItems) {
      return selectedOrders.reduce((sum, order) => {
        const items = order.items || [];
        return (
          sum +
          items.reduce((s, item, idx) => {
            const cancelled = order.cancelledItems?.some((c) => c.itemIndex === idx) ?? false;
            if (cancelled) return s;
            return s + getItemSubtotal(item as CashierOrderItem);
          }, 0)
        );
      }, 0);
    }

    const ordersTotal = selectedOrders.reduce((sum, order) => {
      return sum + Number(order.total || 0);
    }, 0);

    return ordersTotal > 0 ? ordersTotal : Number(selectedCuenta.total || 0);
  }, [selectedOrders, selectedCuenta]);

  const discountAmount = useMemo(() => {
    const value = Number(discountValue || 0);

    if (!Number.isFinite(value) || value <= 0) return 0;
    if (discountType === "fixed") return Math.min(realSubtotal, value);
    if (discountType === "percentage") {
      return Math.min(realSubtotal, (realSubtotal * value) / 100);
    }

    return 0;
  }, [discountType, discountValue, realSubtotal]);

  const twoForOneDiscount = useMemo(() => {
    const items = selectedItems
      .filter((item) => !item._cancelled)
      .map((item) => ({
        name: getItemName(item),
        price: getItemPrice(item),
        quantity: getItemQuantity(item),
      }));
    return calcTwoForOneDiscount(items, twoForOnePromos);
  }, [selectedItems, twoForOnePromos]);

  const extraAmount = useMemo(() => {
    const value = Number(manualExtraAmount || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [manualExtraAmount]);

  const finalTotal = useMemo(() => {
    return Math.max(
      0,
      realSubtotal - discountAmount - twoForOneDiscount + extraAmount
    );
  }, [realSubtotal, discountAmount, twoForOneDiscount, extraAmount]);

  const paidTotal = useMemo(() => {
    if (!selectedCuenta) return 0;

    if (selectedCuenta.payments && selectedCuenta.payments.length > 0) {
      return selectedCuenta.payments.reduce((sum, payment) => {
        return sum + Number(payment.amount || 0);
      }, 0);
    }

    return Number(selectedCuenta.paidAmount || 0);
  }, [selectedCuenta]);

  const remainingAmount = useMemo(() => {
    return Math.max(0, finalTotal - paidTotal);
  }, [finalTotal, paidTotal]);

  const currentPaymentAmount = Number(paymentAmount || 0);

  const isPaymentAmountInvalid =
    !Number.isFinite(currentPaymentAmount) || currentPaymentAmount <= 0;

  const splitProductSubtotal = useMemo(() => {
    const unitPriceMap = new Map<string, number>();
    for (const item of selectedItems) {
      if (!item._cancelled) {
        const itemKey = `${item._pedidoId}:${item._itemIndex}`;
        const qty = getItemQuantity(item as CashierOrderItem);
        const subtotal = getItemSubtotal(item as CashierOrderItem);
        unitPriceMap.set(itemKey, qty > 0 ? subtotal / qty : 0);
      }
    }
    return Object.entries(splitProductSelection)
      .filter(([, checked]) => checked)
      .reduce((sum, [key]) => {
        const itemKey = key.split(":").slice(0, 2).join(":");
        return sum + (unitPriceMap.get(itemKey) ?? 0);
      }, 0);
  }, [selectedItems, splitProductSelection]);

  const manualTotal = useMemo(() => {
    return manualItems.reduce((sum, item) => {
      return sum + item.menuItem.price * item.quantity;
    }, 0);
  }, [manualItems]);

  const paidCuentasToday = useMemo(() => {
    return cuentas.filter((c) => {
      if (c.estado !== "pagada") return false;
      if (!cashSession) return true;
      const ts = getTimestampMs(c.createdAt);
      return ts === 0 || ts >= cashSession.openedAt;
    });
  }, [cuentas, cashSession]);

  const paymentBreakdown = useMemo(() => {
    const breakdown: Partial<Record<CashierPaymentMethod, { count: number; total: number }>> = {};
    const add = (method: CashierPaymentMethod, amount: number) => {
      if (!breakdown[method]) breakdown[method] = { count: 0, total: 0 };
      breakdown[method]!.count += 1;
      breakdown[method]!.total += amount;
    };
    for (const cuenta of paidCuentasToday) {
      if (cuenta.payments && cuenta.payments.length > 0) {
        for (const p of cuenta.payments) add(p.method, p.amount);
      } else if (cuenta.metodo) {
        add(cuenta.metodo as CashierPaymentMethod, Number(cuenta.total || 0));
      } else {
        add("other", Number(cuenta.total || 0));
      }
    }
    return breakdown;
  }, [paidCuentasToday]);

  const totalRecaudado = useMemo(
    () =>
      paidCuentasToday.reduce((sum, c) => {
        const paid =
          c.paidAmount != null && c.paidAmount > 0
            ? c.paidAmount
            : Number(c.total || 0);
        return sum + paid;
      }, 0),
    [paidCuentasToday]
  );

  const totalEfectivo = paymentBreakdown.cash?.total ?? 0;
  const totalTips = paidCuentasToday.reduce((s, c) => s + Number(c.tip || 0), 0);
  const totalAjustesAdd = cashSession?.adjustments
    ?.filter((a) => a.type === "add")
    .reduce((s, a) => s + a.amount, 0) ?? 0;
  const totalAjustesDeduct = cashSession?.adjustments
    ?.filter((a) => a.type === "deduct")
    .reduce((s, a) => s + a.amount, 0) ?? 0;
  const totalCajaActual =
    (cashSession?.openingCash ?? 0) + totalEfectivo + totalAjustesAdd - totalAjustesDeduct;

  const selectedPaymentLabel =
    selectedCuenta?.metodo && paymentLabels[selectedCuenta.metodo]
      ? paymentLabels[selectedCuenta.metodo]
      : selectedCuenta?.metodo
        ? selectedCuenta.metodo
        : "Sin definir";

  const addDraftManualItem = () => {
    const menuItem = menuItems.find((item) => item.id === manualSelectedMenuId);
    const quantity = Number(manualQuantity);

    if (!menuItem) return alert("Seleccioná un producto.");
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return toast.error("Cantidad inválida.");
    }

    setManualItems((prev) => {
      const existingIndex = prev.findIndex(
        (item) => item.menuItem.id === menuItem.id
      );

      if (existingIndex >= 0) {
        const copy = [...prev];
        copy[existingIndex] = {
          ...copy[existingIndex],
          quantity: copy[existingIndex].quantity + quantity,
        };
        return copy;
      }

      return [...prev, { menuItem, quantity }];
    });

    setManualSelectedMenuId("");
    setManualQuantity("1");
  };

  const createManualBill = async () => {
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId) return;

    const mesa = Number(manualMesa);

    if (!Number.isInteger(mesa) || mesa <= 0) {
      toast.error("Ingresá una mesa válida.");
      return;
    }

    if (manualItems.length === 0) {
      toast.error("Agregá al menos un producto.");
      return;
    }

    try {
      setProcessing(true);
      setError(null);

      // Manual bills have no QR session. Create the cuenta document directly
      // instead of going through pedirCuenta (which requires an occupied mesa).
      const cuentaRef = doc(
        collection(db, "restaurants", restaurantId, "cuentas")
      );
      const batch = writeBatch(db);
      batch.set(cuentaRef, {
        restaurantId,
        mesa,
        total: manualTotal,
        sessionId: null,
        estado: "pendiente",
        metodo: null,
        splitBill: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      writeAuditLog(batch, {
        restaurantId,
        action: "cashier_bill_created",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "cashier",
        mesa,
        cuentaId: cuentaRef.id,
        description: `Caja creo una cuenta manual para mesa ${mesa}`,
        changes: {
          before: { exists: false },
          after: { estado: "pendiente", total: manualTotal, source: "manual" },
        },
        metadata: { total: manualTotal, source: "manual" },
      });
      await batch.commit();

      setManualMesa("");
      setManualItems([]);
      toast.success("Cuenta manual creada. Seleccionala de la lista para cobrar.");
    } catch (err) {
      console.error("Error creando cuenta manual:", err);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo crear la cuenta manual."
      );
    } finally {
      setProcessing(false);
    }
  };

  const addItemToSelectedBill = async () => {
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    if (!selectedCuenta.sessionId) {
      toast.error("Las cuentas manuales no admiten agregar productos por esta vía.");
      return;
    }

    if (
      selectedCuenta.estado === "pagada" ||
      selectedCuenta.estado === "cerrada"
    ) {
      toast.error("No se pueden agregar productos a una cuenta pagada o cerrada.");
      return;
    }

    const menuItem = menuItems.find((item) => item.id === addSelectedMenuId);
    const quantity = Number(addQuantity);

    if (!menuItem) return  toast.error("Seleccioná un producto.");
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return alert("Cantidad inválida.");
    }

    try {
      setProcessing(true);
      setError(null);

      const category = getMenuItemType(menuItem);

      await unlockSessionForCashierAdd({
        restaurantId,
        sessionId: selectedCuenta.sessionId,
      });

   await crearPedido({
      restaurantId,
      mesa: Number(selectedCuenta.mesa),
      sessionId: selectedCuenta.sessionId || "",
      items: [
        {
          id: menuItem.id,
          nombre: menuItem.name,
          name: menuItem.name,
          cantidad: quantity,
          quantity,
          precio: menuItem.price,
          price: menuItem.price,
          subtotal: menuItem.price * quantity,
          category,
          displayCategory: menuItem.category || "",
          observacion: "Producto agregado manualmente por caja",
          ingredients: menuItem.ingredients || [],
        } as unknown as PedidoItem,
      ],
      total: menuItem.price * quantity,
    });

      await createOrRefreshCashierBill({
        data: {
          restaurantId,
          mesa: Number(selectedCuenta.mesa),
          metodo: selectedCuenta.metodo || null,
          total: finalTotal,
          splitBill: selectedCuenta.splitBill || false,
        },
        actorUid: user.uid,
        actorEmail: user.email,
      });

      setAddSelectedMenuId("");
      setAddQuantity("1");
    } catch (err) {
      console.error("Error agregando producto:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo agregar el producto."
      );
    } finally {
      setProcessing(false);
    }
  };

  const saveAdjustments = async () => {
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    try {
      setProcessing(true);
      setError(null);

      await updateCashierBillAdjustments({
        restaurantId,
        cuentaId: selectedCuenta.id,
        discountType,
        discountValue: Number(discountValue || 0),
        discountReason,
        manualExtraAmount: Number(manualExtraAmount || 0),
        manualExtraReason,
        actorUid: user.uid,
        actorEmail: user.email,
      });

    } catch (err) {
      console.error("Error guardando ajustes:", err);
      setError(
        err instanceof Error ? err.message : "No se pudieron guardar ajustes."
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleMarkPaid = async () => {
    if (markPaidLockRef.current) return;
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    markPaidLockRef.current = true;
    try {
      setProcessing(true);
      setError(null);

      const amount = Number(paymentAmount);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Monto de pago inválido.");
      }

      const tip = Number(tipAmount || 0);
      await addPartialPayment({
        restaurantId,
        cuentaId: selectedCuenta.id,
        mesa: Number(selectedCuenta.mesa),
        payment: { id: crypto.randomUUID(), method: paymentMethod, amount },
        finalTotal,
        actorUid: user.uid,
        actorEmail: user.email,
        tip: tip > 0 ? tip : undefined,
      });
      setSplitProductSelection({});
    } catch (err) {
      console.error("Error registrando pago:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo registrar el pago."
      );
    } finally {
      setProcessing(false);
      markPaidLockRef.current = false;
    }
  };

  const handleReopenBill = async () => {
    if (!selectedCuenta || !user) return;
    if (!reopenReason.trim() || reopenReason.trim().length < 4) {
      toast.error("Ingresá un motivo claro (mínimo 4 caracteres).");
      return;
    }
    try {
      setProcessing(true);
      await reopenCashierBill({
        restaurantId,
        cuentaId: selectedCuenta.id,
        reason: reopenReason,
        actorUid: user.uid,
        actorEmail: user.email,
      });
      setShowReopenModal(false);
      setReopenReason("");
      setSplitPaidKeys({});
      setSplitProductSelection({});
      toast.success("Cuenta reabierta.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reabrir.");
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveInternalNote = async () => {
    if (!selectedCuenta || !restaurantId || !user) return;
    try {
      const ref = doc(db, "restaurants", restaurantId, "cuentas", selectedCuenta.id);
      const batch = writeBatch(db);
      batch.update(ref, { internalNote: internalNote.trim(), updatedAt: serverTimestamp() });
      writeAuditLog(batch, {
        restaurantId,
        action: "cashier_internal_note_updated",
        actorUid: user.uid,
        actorEmail: user.email,
        actorRole: "cashier",
        mesa: Number(selectedCuenta.mesa),
        cuentaId: selectedCuenta.id,
        description: `Caja actualizo nota interna de cuenta ${selectedCuenta.id}`,
        changes: {
          before: { internalNote: selectedCuenta.internalNote || "" },
          after: { internalNote: internalNote.trim() },
        },
      });
      await batch.commit();
      toast.success("Nota guardada.");
    } catch {
      toast.error("No se pudo guardar la nota.");
    }
  };

  const handleCancelItem = async () => {
    if (!cancelItemTarget || !user || !restaurantId) return;
    if (!cancelItemReason.trim() || cancelItemReason.trim().length < 3) {
      toast.error("Ingresá un motivo para la cancelación.");
      return;
    }
    try {
      setProcessing(true);
      const idToken = await user.getIdToken();
      const res = await fetch("/api/cancel-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          restaurantId,
          pedidoId: cancelItemTarget.pedidoId,
          itemIndex: cancelItemTarget.itemIndex,
          reason: cancelItemReason.trim(),
        }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Error desconocido");
      setCancelItemTarget(null);
      setCancelItemReason("");
      toast.success(`"${cancelItemTarget.name}" cancelado.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo cancelar el ítem.";
      toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  const metodoLabel: Record<string, string> = {
    cash: "Efectivo",
    debit: "Débito",
    credit: "Crédito",
    transfer: "Transferencia",
    mercado_pago: "Mercado Pago",
    mixed: "Pago mixto",
    other: "Otro",
  };

  const openTicketPopup = (opts: {
    mesa: number;
    items: (CashierOrderItem & { _cancelled?: boolean })[];
    subtotal: number;
    discountAmount: number;
    discountReason?: string;
    extraAmount: number;
    extraReason?: string;
    finalTotal: number;
    payments?: { method: string; amount: number; note?: string }[];
    metodo?: string | null;
    tip?: number;
    restaurantName: string;
  }) => {
    const fmt = (n: number) =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
    const now = new Intl.DateTimeFormat("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).format(new Date());

    const activeItems = opts.items.filter((i) => !i._cancelled);
    const itemRows = activeItems.map((item) => {
      const name = item.nombre || item.name || "Ítem";
      const qty = item.cantidad || item.quantity || 1;
      const sub = item.subtotal ?? qty * (item.precio || item.price || 0);
      const note = item.observacion || item.note;
      return `<tr><td>${qty}x ${name}${note ? `<br><small style="color:#666">${note}</small>` : ""}</td><td style="text-align:right;white-space:nowrap">${fmt(sub)}</td></tr>`;
    }).join("");

    const paymentRows = (opts.payments || []).map((p) =>
      `<tr><td>${metodoLabel[p.method] || p.method}${p.note ? " — " + p.note : ""}</td><td style="text-align:right">${fmt(p.amount)}</td></tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Ticket Mesa ${opts.mesa}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;max-width:80mm;margin:0 auto;padding:6px}
  .center{text-align:center}
  .bold{font-weight:bold}
  hr{border:none;border-top:1px dashed #aaa;margin:5px 0}
  .row{display:flex;justify-content:space-between;padding:1px 0}
  .total{font-size:13px;font-weight:bold}
  .small{font-size:9px;color:#555;text-transform:uppercase}
  table{width:100%;border-collapse:collapse}
  td{padding:2px 0;vertical-align:top}
  @media print{body{padding:0}}
</style>
</head>
<body>
  <div class="center">
    <p class="bold" style="font-size:13px">${opts.restaurantName}</p>
    <p class="small">Ticket &mdash; No válido como factura</p>
  </div>
  <hr/>
  <div style="display:flex;justify-content:space-between">
    <span><span class="small">Mesa</span><br><span class="bold" style="font-size:16px">${opts.mesa}</span></span>
    <span style="text-align:right"><span class="small">Fecha</span><br>${now}</span>
  </div>
  <hr/>
  <table>
    <thead><tr>
      <th style="text-align:left;font-size:9px;text-transform:uppercase;padding-bottom:3px;border-bottom:1px solid #ccc">Producto</th>
      <th style="text-align:right;font-size:9px;text-transform:uppercase;border-bottom:1px solid #ccc">Subtotal</th>
    </tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <hr/>
  ${opts.subtotal !== opts.finalTotal ? `<div class="row"><span>Subtotal</span><span>${fmt(opts.subtotal)}</span></div>` : ""}
  ${opts.discountAmount > 0 ? `<div class="row"><span>Descuento${opts.discountReason ? " — " + opts.discountReason : ""}</span><span>&minus;${fmt(opts.discountAmount)}</span></div>` : ""}
  ${opts.extraAmount > 0 ? `<div class="row"><span>${opts.extraReason || "Extra"}</span><span>+${fmt(opts.extraAmount)}</span></div>` : ""}
  <div class="row total"><span>TOTAL</span><span>${fmt(opts.finalTotal)}</span></div>
  ${opts.tip ? `<div class="row"><span>Propina</span><span>${fmt(opts.tip)}</span></div>` : ""}
  ${paymentRows ? `<hr/><p class="small">Forma de pago</p><table><tbody>${paymentRows}</tbody></table>` : opts.metodo ? `<hr/><p class="small">Forma de pago</p><p>${metodoLabel[opts.metodo] || opts.metodo}</p>` : ""}
  <script>window.onload=()=>{window.print()}</script>
</body>
</html>`;

    const win = window.open("", "_blank", "width=420,height=600");
    if (!win) { toast.error("Bloqueado por el navegador. Permitir popups."); return; }
    win.document.write(html);
    win.document.close();
  };

  const handlePrint = async () => {
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    try {
      await markCashierBillPrinted({
        restaurantId,
        cuentaId: selectedCuenta.id,
        mesa: Number(selectedCuenta.mesa),
        actorUid: user.uid,
        actorEmail: user.email,
      });

      openTicketPopup({
        mesa: selectedCuenta.mesa,
        items: selectedItems,
        subtotal: realSubtotal,
        discountAmount,
        discountReason: selectedCuenta.discountReason,
        extraAmount,
        extraReason: selectedCuenta.manualExtraReason,
        finalTotal,
        payments: selectedCuenta.payments,
        metodo: selectedCuenta.metodo,
        tip: selectedCuenta.tip,
        restaurantName: restaurant?.name || restaurantId,
      });
    } catch (err) {
      console.error("Error registrando impresión:", err);
      alert("No se pudo registrar la impresión.");
    }
  };

  const handleRequestInvoice = async () => {
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    if (!invoiceCustomerName.trim()) return alert("Ingresá el nombre del cliente.");
    if (!invoiceDocumentNumber.trim()) return alert("Ingresá el documento del cliente.");
    if (invoiceDocumentType === "CUIT" && !validateCuit(invoiceDocumentNumber))
      return alert("El CUIT ingresado no es válido. Verificá los 11 dígitos.");
    if (!invoiceIvaCondition.trim()) return alert("Ingresá la condición frente al IVA.");
    if (!invoiceFiscalAddress.trim()) return alert("Ingresá la dirección fiscal.");
    if (!invoicePostalCode.trim()) return alert("Ingresá el código postal.");
    if (!invoiceEmail.trim()) return alert("El email del cliente es obligatorio para enviar la factura electrónica.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail.trim())) return alert("Ingresá un email válido.");

    try {
      setProcessing(true);
      setError(null);

      // Guardar datos de factura en Firestore (status "requested")
      await requestCashierInvoice({
        restaurantId,
        cuentaId: selectedCuenta.id,
        actorUid: user.uid,
        actorEmail: user.email,
        invoice: {
          status: "requested",
          type: invoiceType,
          customerName: invoiceCustomerName.trim(),
          documentType: invoiceDocumentType,
          documentNumber: invoiceDocumentNumber.trim(),
          ivaCondition: invoiceIvaCondition.trim(),
          fiscalRegime: invoiceFiscalRegime.trim(),
          fiscalAddress: invoiceFiscalAddress.trim(),
          postalCode: invoicePostalCode.trim(),
          province: invoiceProvince.trim(),
          city: invoiceCity.trim(),
          email: invoiceEmail.trim(),
          provider: "manual",
        },
      });

      // Intentar emisión automática vía AFIP si el restaurante lo tiene configurado
      try {
        const fns = getFunctions(undefined, "us-central1");
        const afipIssue = httpsCallable<unknown, { cae: string; invoiceNumber: number; invoiceType: string }>(
          fns, "afipIssueInvoice"
        );
        // "ticket" no es un tipo ARCA válido — lo mapeamos a "B" para RI o "C" para monotributista
        const arcaInvoiceType = (invoiceType === "A" || invoiceType === "B" || invoiceType === "C")
          ? invoiceType
          : null;

        if (!arcaInvoiceType) {
          // Tipo "ticket" u otro: no llamamos ARCA, queda como solicitud manual
          throw new Error("tipo_no_arca");
        }

        const docType = invoiceDocumentType === "CUIT" ? "CUIT"
          : invoiceDocumentType === "DNI" ? "DNI"
          : "consumidor_final";

        const result = await afipIssue({
          restaurantId,
          cuentaId: selectedCuenta.id,
          customerName: invoiceCustomerName.trim(),
          customerDocType: docType,
          customerDocNumber: invoiceDocumentNumber.trim() || undefined,
          email: invoiceEmail.trim(),
          invoiceType: arcaInvoiceType,
          total: finalTotal,
        });

        toast.success(
          `Factura ${result.data.invoiceType} N° ${result.data.invoiceNumber} emitida. CAE: ${result.data.cae}`
        );
      } catch (afipErr) {
        // Si AFIP no está configurado o falla, la solicitud manual ya quedó guardada
        const msg = afipErr instanceof Error ? afipErr.message : "";
        const silencioso = msg.includes("no tiene AFIP configurado")
          || msg.includes("no está activa")
          || msg === "tipo_no_arca";
        if (!silencioso) {
          console.warn("ARCA error (no crítico):", afipErr);
        }
        // Silencioso si AFIP no está configurado — la solicitud manual alcanza
      }

    } catch (err) {
      console.error("Error solicitando factura:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo solicitar la factura."
      );
    } finally {
      setProcessing(false);
    }
  };

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      await logout();
    } catch {
      setLoggingOut(false);
    }
  };

  const confirmOpeningCash = async (forcedAmount?: number) => {
    if (!sessionKey || !restaurantId || !user?.uid) return;
    const amount =
      forcedAmount !== undefined
        ? forcedAmount
        : Math.max(0, Number(openingCashInput) || 0);

    setOpeningCaja(true);
    try {
      const session = {
        openingCash: amount,
        openedAt: Date.now(),
        adjustments: cashSession?.adjustments ?? [],
      };

      // Persist to Firestore first — if this fails, the cashier stays on the dialog
      const ref = await addDoc(
        collection(db, "restaurants", restaurantId, "cajaTurnos"),
        {
          restaurantId,
          actorUid: user.uid,
          actorEmail: user.email ?? "",
          status: "open",
          openingCash: amount,
          openedAt: session.openedAt,
          adjustments: [],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      setCajaTurnoId(ref.id);
      localStorage.setItem(sessionKey, JSON.stringify(session));
      setCashSession(session);
      setShowOpeningDialog(false);
    } catch (err) {
      console.error("Error abriendo caja:", err);
      toast.error(
        "No se pudo registrar la apertura de caja. Verificá tu conexión y reintentá."
      );
    } finally {
      setOpeningCaja(false);
    }
  };

  const handleCierreCaja = async () => {
    if (!restaurantId || !cashSession || !user) return;
    const arqueoRealValue =
      cajaArqueoRealInput.trim() !== ""
        ? Math.max(0, Number(cajaArqueoRealInput) || 0)
        : undefined;
    try {
      setClosingCaja(true);
      const now = Date.now();

      // Persist cierre to Firestore cajaTurno
      if (cajaTurnoId) {
        await updateDoc(
          doc(db, "restaurants", restaurantId, "cajaTurnos", cajaTurnoId),
          {
            status: "closed",
            closedAt: now,
            cierre: {
              closedAt: now,
              totalEfectivo,
              totalRecaudado,
              totalTips,
              arqueoEsperado: totalCajaActual,
              ...(arqueoRealValue !== undefined && {
                arqueoReal: arqueoRealValue,
                diferencia: arqueoRealValue - totalCajaActual,
              }),
              ajustesAdd: totalAjustesAdd,
              ajustesDeduct: totalAjustesDeduct,
              efectivoFinal: totalCajaActual,
              paymentBreakdown,
              paidCuentasCount: paidCuentasToday.length,
            },
            updatedAt: serverTimestamp(),
          }
        );
      }

      await createCashierAuditLog({
        restaurantId,
        action: "cierre_caja",
        actorUid: user.uid,
        actorEmail: user.email,
        entityType: "cash_session",
        entityId: cajaTurnoId ?? `${user.uid}:${cashSession.openedAt}`,
        description: `Cierre de caja · Monto inicial: ${formatPriceARS(cashSession.openingCash)} · Efectivo cobrado: ${formatPriceARS(totalEfectivo)} · Ajustes: +${formatPriceARS(totalAjustesAdd)} / −${formatPriceARS(totalAjustesDeduct)} · Efectivo final: ${formatPriceARS(totalCajaActual)}${arqueoRealValue !== undefined ? ` · Arqueo real: ${formatPriceARS(arqueoRealValue)} · Diferencia: ${formatPriceARS(arqueoRealValue - totalCajaActual)}` : ""}`,
        changes: {
          before: { status: "open", openingCash: cashSession.openingCash },
          after: {
            status: "closed",
            efectivoFinal: totalCajaActual,
            ...(arqueoRealValue !== undefined && {
              arqueoReal: arqueoRealValue,
              diferencia: arqueoRealValue - totalCajaActual,
            }),
          },
        },
        metadata: {
          montoInicial: cashSession.openingCash,
          efectivoCobrado: totalEfectivo,
          ajustesAdd: totalAjustesAdd,
          ajustesDeduct: totalAjustesDeduct,
          efectivoFinal: totalCajaActual,
          totalRecaudado,
          ...(arqueoRealValue !== undefined && {
            arqueoReal: arqueoRealValue,
            diferencia: arqueoRealValue - totalCajaActual,
          }),
        },
      });

      if (sessionKey) localStorage.removeItem(sessionKey);
      toast.success("Caja cerrada y registrada en auditoría.");
      setShowCierreModal(false);
      setCajaTurnoId(null);
      setCashSession(null);
      setCajaArqueoRealInput("");
      setShowOpeningDialog(true);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo registrar el cierre de caja.");
    } finally {
      setClosingCaja(false);
    }
  };

  const handleExportCierre = () => {
    if (!cashSession) return;

    const fmt = (v: number) =>
      new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(v);
    const fmtDate = (d: Date) =>
      new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(d);
    const fmtTime = (d: Date) =>
      new Intl.DateTimeFormat("es-AR", { timeStyle: "short" }).format(d);

    const now = new Date();
    const restaurantName = restaurant?.name ?? "Restaurante";
    const cajero = user?.email ?? "—";
    const apertura = fmtDate(new Date(cashSession.openedAt));
    const cierre = fmtDate(now);

    // Cancelled items count from orders paid today
    const cancelledCount = paidCuentasToday.reduce((sum, c) => {
      const cOrders = orders.filter((o) =>
        c.sessionId ? o.sessionId === c.sessionId : Number(o.mesa) === Number(c.mesa)
      );
      return sum + cOrders.reduce((s, o) => s + (o.cancelledItems?.length ?? 0), 0);
    }, 0);

    // Average ticket (excluding tips)
    const avgTicket = paidCuentasToday.length > 0 ? Math.round(totalRecaudado / paidCuentasToday.length) : 0;

    // Arqueo
    const arqueoRealValue =
      cajaArqueoRealInput.trim() !== "" ? Math.max(0, Number(cajaArqueoRealInput) || 0) : undefined;
    const arqueoEsperado = totalCajaActual;
    const arqueoDiferencia = arqueoRealValue !== undefined ? arqueoRealValue - arqueoEsperado : undefined;

    // Payment breakdown rows
    const methodRows = (Object.entries(paymentBreakdown) as [CashierPaymentMethod, { count: number; total: number }][])
      .sort((a, b) => b[1].total - a[1].total)
      .map(([method, data]) =>
        `<tr><td>${paymentLabels[method] || method}</td><td style="text-align:center">${data.count}</td><td style="text-align:right;font-weight:700">${fmt(data.total)}</td></tr>`
      ).join("");

    // Adjustment rows
    const adjRows = (cashSession.adjustments ?? [])
      .map((a) =>
        `<tr><td class="${a.type === "add" ? "pos" : "neg"}">${a.type === "add" ? "+" : "−"} ${fmt(a.amount)}</td><td>${a.reason}</td><td style="text-align:right;color:#999">${fmtTime(new Date(a.createdAt))}</td></tr>`
      ).join("");

    // Bill detail rows — multi-payment aware
    const cuentaRows = paidCuentasToday
      .sort((a, b) => Number(a.mesa) - Number(b.mesa))
      .map((c) => {
        const paid = c.paidAmount != null && c.paidAmount > 0 ? c.paidAmount : Number(c.total || 0);
        const methodText = c.payments && c.payments.length > 1
          ? c.payments.map((p) => `${paymentLabels[p.method] || p.method} ${fmt(p.amount)}`).join(" + ")
          : paymentLabels[(c.payments?.[0]?.method ?? c.metodo ?? "other") as CashierPaymentMethod] || "Otro";
        const tipCell = c.tip && c.tip > 0 ? `<td style="text-align:right;color:#059669">${fmt(c.tip)}</td>` : "<td style='text-align:right;color:#bbb'>—</td>";
        return `<tr><td>Mesa <strong>${c.mesa}</strong></td><td>${methodText}</td><td style="text-align:right;font-weight:700">${fmt(paid)}</td>${tipCell}</tr>`;
      }).join("");

    // Arqueo section HTML
    const arqueoHtml = arqueoRealValue !== undefined ? `
<div class="section">
  <h2>Arqueo de caja</h2>
  <table>
    <tr><td>Arqueo esperado</td><td style="text-align:right;font-weight:700">${fmt(arqueoEsperado)}</td></tr>
    <tr><td>Arqueo real (contado)</td><td style="text-align:right;font-weight:700">${fmt(arqueoRealValue)}</td></tr>
    <tr class="${arqueoDiferencia! >= 0 ? "pos-row" : "neg-row"}">
      <td><strong>Diferencia</strong></td>
      <td style="text-align:right;font-weight:700">${arqueoDiferencia! >= 0 ? "+" : ""}${fmt(arqueoDiferencia!)}</td>
    </tr>
  </table>
</div>` : "";

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cierre de caja · ${restaurantName} · ${cierre}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;color:#111;background:#fff;padding:32px;max-width:760px;margin:0 auto}
  .header{border-bottom:2px solid #111;padding-bottom:16px;margin-bottom:24px}
  .header h1{font-size:22px;font-weight:800;letter-spacing:-0.5px}
  .header .doc-type{font-size:13px;color:#555;margin-top:2px}
  .meta{display:flex;gap:32px;margin-top:12px;flex-wrap:wrap}
  .meta-item{font-size:12px;color:#555}.meta-item strong{color:#111;display:block}
  .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:24px}
  .card{border:1px solid #ddd;border-radius:6px;padding:12px 14px}
  .card .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;font-weight:700}
  .card .value{font-size:19px;font-weight:800;margin-top:4px;color:#111}
  .card.tips .value{color:#059669}
  .section{margin-bottom:22px}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#888;font-weight:700;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eee}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-size:11px;text-transform:uppercase;color:#aaa;font-weight:700;border-bottom:1px solid #ddd;padding:6px 4px}
  td{padding:6px 4px;border-bottom:1px solid #f0f0f0;font-size:13px}
  .pos{color:#059669;font-weight:700}.neg{color:#dc2626;font-weight:700}
  .pos-row td{background:#f0fdf4;color:#059669}
  .neg-row td{background:#fef2f2;color:#dc2626}
  .total-row td{font-weight:800;border-top:2px solid #111;border-bottom:none}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#999}
  .btn{background:#111;color:#fff;border:none;padding:8px 16px;border-radius:4px;font-size:12px;font-weight:700;cursor:pointer;margin-left:8px}
  @media print{
    body{padding:16px}
    .btn,.no-print{display:none!important}
    @page{margin:1.5cm}
  }
</style>
</head>
<body>

<div class="header">
  <h1>${restaurantName}</h1>
  <div class="doc-type">Reporte de cierre de caja</div>
  <div class="meta">
    <div class="meta-item"><strong>Apertura</strong>${apertura}</div>
    <div class="meta-item"><strong>Cierre</strong>${cierre}</div>
    <div class="meta-item"><strong>Cajero</strong>${cajero}</div>
    ${cajaTurnoId ? `<div class="meta-item"><strong>Turno ID</strong><span style="font-family:monospace;font-size:11px">${cajaTurnoId.slice(0, 12)}…</span></div>` : ""}
  </div>
</div>

<div class="summary-grid">
  <div class="card"><div class="label">Monto inicial</div><div class="value">${fmt(cashSession.openingCash)}</div></div>
  <div class="card"><div class="label">Total recaudado</div><div class="value">${fmt(totalRecaudado)}</div></div>
  <div class="card"><div class="label">Efectivo en caja</div><div class="value">${fmt(totalCajaActual)}</div></div>
  <div class="card tips"><div class="label">Propinas</div><div class="value">${fmt(totalTips)}</div></div>
</div>

<div style="display:flex;gap:24px;margin-bottom:24px;flex-wrap:wrap">
  <div style="font-size:12px;color:#555">Cuentas cobradas: <strong style="color:#111">${paidCuentasToday.length}</strong></div>
  <div style="font-size:12px;color:#555">Ticket promedio: <strong style="color:#111">${fmt(avgTicket)}</strong></div>
  ${cancelledCount > 0 ? `<div style="font-size:12px;color:#dc2626">Ítems cancelados: <strong>${cancelledCount}</strong></div>` : ""}
</div>

<div class="section">
  <h2>Recaudación por forma de pago</h2>
  <table>
    <thead><tr><th>Método</th><th style="text-align:center">Cuentas</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${methodRows}</tbody>
    <tfoot><tr class="total-row"><td>Total</td><td></td><td style="text-align:right">${fmt(totalRecaudado)}</td></tr></tfoot>
  </table>
</div>

${arqueoHtml}

${adjRows ? `<div class="section">
  <h2>Ajustes de caja</h2>
  <table>
    <thead><tr><th>Monto</th><th>Motivo</th><th style="text-align:right">Hora</th></tr></thead>
    <tbody>${adjRows}</tbody>
    <tfoot><tr class="total-row">
      <td class="${totalAjustesAdd - totalAjustesDeduct >= 0 ? "pos" : "neg"}">${totalAjustesAdd - totalAjustesDeduct >= 0 ? "+" : ""}${fmt(totalAjustesAdd - totalAjustesDeduct)}</td>
      <td colspan="2">Neto ajustes</td>
    </tr></tfoot>
  </table>
</div>` : ""}

${cuentaRows ? `<div class="section">
  <h2>Detalle de cuentas cobradas (${paidCuentasToday.length})</h2>
  <table>
    <thead><tr><th>Mesa</th><th>Forma de pago</th><th style="text-align:right">Total</th><th style="text-align:right">Propina</th></tr></thead>
    <tbody>${cuentaRows}</tbody>
  </table>
</div>` : ""}

<div class="footer">
  <span>Generado el ${cierre} · Want POS</span>
  <div class="no-print">
    <button class="btn" onclick="window.print()">Imprimir</button>
    <button class="btn" onclick="downloadReport()" style="background:#555">Descargar</button>
  </div>
</div>

<script>
function downloadReport() {
  const blob = new Blob([document.documentElement.outerHTML], {type:'text/html;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cierre-caja-${now.toISOString().slice(0,10)}.html';
  a.click();
}
window.onload = () => { window.print(); };
</script>
</body></html>`;

    const win = window.open("", "_blank", "width=860,height=700");
    if (!win) { toast.error("Bloqueado por el navegador. Permitir popups."); return; }
    win.document.write(html);
    win.document.close();
  };

  const saveAdjustment = async () => {
    if (!sessionKey || !cashSession || !adjustForm) return;
    const amount = Math.max(0, Number(adjustForm.amount) || 0);
    if (amount <= 0 || !adjustForm.reason.trim()) return;

    if (!cajaTurnoId) {
      toast.error("No hay turno de caja activo. Abrí la caja antes de registrar movimientos.");
      return;
    }

    const newAdj: CashAdjustment = {
      id: crypto.randomUUID(),
      type: adjustForm.type,
      amount,
      reason: adjustForm.reason.trim(),
      createdAt: Date.now(),
    };

    const updated = {
      ...cashSession,
      adjustments: [...(cashSession.adjustments ?? []), newAdj],
    };

    try {
      // Persist to Firestore first — if this fails, local state stays unchanged
      await updateDoc(doc(db, "restaurants", restaurantId!, "cajaTurnos", cajaTurnoId), {
        adjustments: updated.adjustments,
        updatedAt: serverTimestamp(),
      });

      localStorage.setItem(sessionKey, JSON.stringify(updated));
      setCashSession(updated);
      setAdjustForm(null);
    } catch (err) {
      console.error("Error guardando ajuste:", err);
      toast.error("No se pudo guardar el movimiento. Verificá tu conexión y reintentá.");
    }
  };

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d0d0d] p-6">
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-center">
          <h1 className="text-lg font-bold text-white">Falta restaurante activo</h1>
          <p className="mt-2 text-sm text-zinc-400">Entrá con una URL que tenga restaurantId.</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-[#0d0d0d]">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-zinc-600">
              WANT POS
            </p>
            <h1 className="mt-1 text-4xl font-bold tracking-tight text-white">
              Caja
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Cuentas, cobros, descuentos, carga manual e impresión.
            </p>
            <div
              className={`mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${
                isOnline
                  ? "border-lime-500/30 bg-lime-500/10 text-lime-400"
                  : "border-red-500/30 bg-red-500/10 text-red-400"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-lime-400" : "bg-red-400"}`} />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Pendientes
                </p>
                <p className="mt-1 text-3xl font-bold text-white">
                  {pendingBills.length}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Sesiones activas
                </p>
                <p className="mt-1 text-3xl font-bold text-white">
                  {activeBills.length}
                </p>
              </div>

              <Link
                to={invoiceRequestsPath}
                className="col-span-2 flex rounded-xl border border-white/10 bg-white/5 px-5 py-4 transition hover:bg-white/10 sm:col-span-1"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                    Facturas
                  </p>
                  <p className="mt-1 text-3xl font-bold text-white">
                    {invoiceRequestsCount}
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-500">
                    Ver solicitudes
                  </p>
                </div>
              </Link>
            </div>

            <div className="flex gap-2">
              <Link
                to={waitlistPath}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white sm:flex-none"
              >
                <Users size={15} />
                Lista de espera
              </Link>

              <button
                onClick={() => setShowCierreModal(true)}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-bold text-zinc-300 transition hover:border-white/20 hover:text-white sm:flex-none"
              >
                <BarChart3 size={15} />
                Cierre de caja
              </button>

              <button
                onClick={() => setCompactMode((v) => !v)}
                className={`hidden md:flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition ${compactMode ? "border-lime-500/40 bg-lime-500/15 text-lime-400" : "border-white/10 bg-white/5 text-zinc-500 hover:text-zinc-300"}`}
                title="Vista compacta"
              >
                Compacto
              </button>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 text-sm font-bold text-zinc-500 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
              >
                <LogOut size={15} />
                {loggingOut ? "Saliendo..." : "Cerrar sesión"}
              </button>
            </div>
          </div>
        </div>
        {!isOnline && (
          <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-bold text-red-400">
            Sin conexión. Estás viendo datos guardados localmente. Los cobros,
            facturas y modificaciones están deshabilitados hasta reconectar.
          </div>
        )}
        {error && (
          <div className="mb-5 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
            {error}
          </div>
        )}

        <div className={`grid gap-6 lg:grid-cols-[390px_1fr] ${compactMode ? "text-sm [&_h3]:text-sm [&_.rounded-xl]:rounded-lg [&_p-4]:p-3 [&_p-6]:p-4" : ""}`}>
          <div className="space-y-6">
            <section className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
              <div className="mb-4 flex items-center gap-2">
                <Receipt size={18} className="text-zinc-500" />
                <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-zinc-400">
                  Cuentas activas
                </h2>
              </div>

              {loading ? (
                <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-zinc-500">
                  Cargando cuentas...
                </div>
              ) : activeBills.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
                  <AlertTriangle className="mx-auto mb-3 text-zinc-600" />
                  <p className="font-semibold text-zinc-500">No hay cuentas activas</p>
                </div>
              ) : (
                <div>
                  {stalePendingBills.length > 0 && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
                      <AlertTriangle size={14} className="shrink-0 text-amber-400" />
                      <span className="text-xs font-semibold text-amber-400">
                        {stalePendingBills.length === 1
                          ? `Mesa ${stalePendingBills[0].mesa} lleva más de ${BILL_WARN_MINUTES} min abierta`
                          : `${stalePendingBills.length} cuentas llevan más de ${BILL_WARN_MINUTES} min sin cobrar`}
                      </span>
                    </div>
                  )}
                <div className="space-y-2">
                  {activeBills.map((cuenta) => {
                    const selected = selectedCuenta?.id === cuenta.id;
                    const ageMins = getBillAgeMinutes(cuenta);
                    const isStale = cuenta.estado === "pendiente" && ageMins >= BILL_WARN_MINUTES;
                    const isDangerBill = isStale && ageMins >= BILL_DANGER_MINUTES;

                    return (
                      <div key={cuenta.id} className="relative">
                        <button
                          onClick={() => setSelectedCuentaId(cuenta.id)}
                          className={`w-full rounded-xl border py-4 pl-4 pr-12 text-left transition ${
                            selected
                              ? "border-lime-500/40 bg-white/10 text-white"
                              : isDangerBill
                              ? "border-red-500/30 bg-red-500/10 hover:border-red-500/50"
                              : isStale
                              ? "border-amber-500/30 bg-amber-500/10 hover:border-amber-500/50"
                              : "border-white/10 bg-white/5 hover:border-white/20"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wide text-zinc-600">Mesa</p>
                              <h3 className="text-3xl font-bold text-white">{cuenta.mesa}</h3>
                              <p className="mt-1 text-xs font-semibold text-zinc-500">{cuenta.estado}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold uppercase tracking-wide text-zinc-600">Total</p>
                              <p className="text-xl font-bold text-zinc-200">{formatPriceARS(cuenta.total)}</p>
                              {ageMins > 0 && (
                                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-bold ${
                                  isDangerBill
                                    ? "bg-red-500/15 text-red-400"
                                    : isStale
                                    ? "bg-amber-500/15 text-amber-400"
                                    : "bg-white/10 text-zinc-500"
                                }`}>
                                  {ageMins}m
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const cuentaOrders = orders.filter((o) =>
                              cuenta.sessionId && o.sessionId
                                ? o.sessionId === cuenta.sessionId
                                : Number(o.mesa) === Number(cuenta.mesa)
                            );
                            const activeItems = cuentaOrders
                              .flatMap((o) =>
                                (o.items || []).map((item, idx) => ({
                                  ...item,
                                  _cancelled: o.cancelledItems?.some((c) => c.itemIndex === idx) ?? false,
                                }))
                              )
                              .filter((i) => !i._cancelled);
                            const ordersTotal = cuentaOrders.reduce((s, o) => s + Number(o.total || 0), 0);
                            const sub = ordersTotal > 0 ? ordersTotal : Number(cuenta.total);
                            const dv = Number(cuenta.discountValue || 0);
                            const da =
                              cuenta.discountType === "fixed" ? Math.min(sub, dv)
                              : cuenta.discountType === "percentage" ? Math.min(sub, (sub * dv) / 100)
                              : 0;
                            const ea = Number(cuenta.manualExtraAmount || 0) > 0 ? Number(cuenta.manualExtraAmount) : 0;
                            openTicketPopup({
                              mesa: cuenta.mesa,
                              items: activeItems,
                              subtotal: sub,
                              discountAmount: da,
                              discountReason: cuenta.discountReason,
                              extraAmount: ea,
                              extraReason: cuenta.manualExtraReason,
                              finalTotal: Math.max(0, sub - da + ea),
                              payments: cuenta.payments,
                              metodo: cuenta.metodo,
                              tip: cuenta.tip,
                              restaurantName: restaurant?.name || restaurantId,
                            });
                          }}
                          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-zinc-500 hover:border-white/20 hover:text-zinc-300"
                          title="Imprimir ticket"
                        >
                          <Printer size={13} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-white/10 bg-[#1a1a1a] p-4">
              <div className="mb-4 flex items-center gap-2">
                <Plus size={16} className="text-zinc-500" />
                <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-zinc-400">
                  Crear cuenta manual
                </h2>
              </div>

              <div className="space-y-2">
                <input
                  value={manualMesa}
                  onChange={(e) => setManualMesa(e.target.value)}
                  type="number"
                  min={1}
                  placeholder="Número de mesa"
                  className="h-11 w-full rounded-lg border border-white/15 bg-white/5 px-4 text-sm text-white placeholder-zinc-600 outline-none focus:ring-1 focus:ring-white/20"
                />

                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <select
                    value={manualSelectedMenuId}
                    onChange={(e) => setManualSelectedMenuId(e.target.value)}
                    className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none"
                  >
                    <option value="" className="bg-zinc-900">Seleccionar producto</option>
                    {menuItems.map((item) => (
                      <option key={item.id} value={item.id} className="bg-zinc-900">
                        {item.name} · {formatPriceARS(item.price)}
                      </option>
                    ))}
                  </select>

                  <input
                    value={manualQuantity}
                    onChange={(e) => setManualQuantity(e.target.value)}
                    type="number"
                    min={1}
                    className="h-11 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none"
                  />
                </div>

                <button
                  onClick={addDraftManualItem}
                  className="h-10 w-full rounded-lg border border-white/15 bg-white/5 text-sm font-bold text-zinc-300 hover:bg-white/10"
                >
                  + Agregar producto
                </button>

                {manualItems.length > 0 && (
                  <div className="space-y-1.5 rounded-lg border border-white/10 bg-white/5 p-3">
                    {manualItems.map((item) => (
                      <div key={item.menuItem.id} className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-zinc-300">
                          {item.menuItem.name} ×{item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            setManualItems((prev) =>
                              prev.filter((current) => current.menuItem.id !== item.menuItem.id)
                            )
                          }
                          className="text-red-500/60 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="border-t border-white/10 pt-2 text-right text-sm font-bold text-zinc-200">
                      {formatPriceARS(manualTotal)}
                    </div>
                  </div>
                )}

                <button
                  onClick={createManualBill}
                  disabled={processing || !isOnline}
                  className="h-11 w-full rounded-lg bg-white/10 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50"
                >
                  Crear cuenta
                </button>
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-xl border border-zinc-800 bg-[#111111] shadow-2xl">
            {!selectedCuenta ? (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center text-center">
                <Receipt size={52} className="mb-4 text-zinc-700" />
                <h2 className="text-2xl font-bold text-zinc-300">Seleccioná una cuenta</h2>
                <p className="mt-2 max-w-sm text-sm text-zinc-600">Elegí una mesa para cobrar.</p>
              </div>
            ) : (
              <>
                {/* ── HEADER ─────────────────────────────── */}
                <div className="border-b border-white/10 px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* status badge */}
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-bold ${
                          selectedCuenta.estado === "pagada"
                            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                            : "border-lime-500/30 bg-lime-500/10 text-lime-400"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${selectedCuenta.estado === "pagada" ? "bg-emerald-400" : "bg-lime-400"}`} />
                          {selectedCuenta.estado === "pagada" ? "PAGADA" : "EN CURSO"}
                        </span>
                        {selectedCuenta.metodo && (
                          <span className="text-xs font-semibold text-zinc-500">{selectedPaymentLabel}</span>
                        )}
                        {selectedCuenta.internalNote && (
                          <span className="max-w-xs truncate text-xs text-amber-400" title={selectedCuenta.internalNote}>
                            "{selectedCuenta.internalNote}"
                          </span>
                        )}
                      </div>
                      <h2 className="mt-1 text-5xl font-bold tracking-tight text-white">Mesa {selectedCuenta.mesa}</h2>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handlePrint}
                        disabled={!isOnline}
                        className="flex h-9 items-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-zinc-300 transition hover:border-white/30 hover:text-white disabled:opacity-40"
                      >
                        <Printer size={15} />
                        Pre-cuenta
                      </button>
                      {selectedCuenta.sessionId &&
                        selectedCuenta.estado !== "pagada" &&
                        selectedCuenta.estado !== "cerrada" && (
                        <button
                          onClick={() => setShowAddProductModal(true)}
                          className="flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15"
                        >
                          <Plus size={15} />
                          Agregar producto
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── 2-COLUMN GRID ──────────────────────── */}
                <div className="grid lg:grid-cols-[1fr_420px]">

                  {/* ── LEFT: Detalle + Ajustes ─────────── */}
                  <div className="border-r border-white/10 p-6">
                    {/* 01 Detalle consumido */}
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                        01 Detalle consumido
                      </p>
                      <span className="text-xs font-semibold text-zinc-600">
                        {selectedItems.filter((i) => !i._cancelled).length} ítems
                        {" · "}
                        {selectedItems
                          .filter((i) => !i._cancelled)
                          .reduce((s, i) => s + getItemQuantity(i as CashierOrderItem), 0)}{" "}
                        u.
                      </span>
                    </div>

                    {selectedItems.length === 0 ? (
                      <p className="text-sm text-zinc-600">Sin productos.</p>
                    ) : (
                      <div className="space-y-0.5">
                        {selectedItems.map((item, index) => {
                          const name = getItemName(item);
                          const quantity = getItemQuantity(item);
                          const price = getItemPrice(item);
                          const subtotal = getItemSubtotal(item);
                          const cancelled = item._cancelled;
                          const canCancel =
                            !cancelled &&
                            selectedCuenta.estado !== "pagada" &&
                            selectedCuenta.estado !== "cerrada";
                          return (
                            <div
                              key={`${name}-${index}`}
                              className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${cancelled ? "opacity-40" : "hover:bg-white/5"}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-semibold leading-snug ${cancelled ? "line-through text-zinc-500" : "text-white"}`}>
                                  {name}
                                </p>
                                <p className="mt-0.5 text-xs text-zinc-500">
                                  {quantity} × {formatPriceARS(price)}
                                </p>
                                {item.observacion && !cancelled && (
                                  <p className="mt-0.5 text-xs text-amber-400">Obs: {item.observacion}</p>
                                )}
                                {cancelled && (
                                  <p className="mt-0.5 text-xs font-semibold text-red-500">Cancelado</p>
                                )}
                              </div>
                              <div className="flex items-center gap-3 shrink-0">
                                <span className={`text-sm font-bold ${cancelled ? "line-through text-zinc-600" : "text-zinc-200"}`}>
                                  {formatPriceARS(subtotal)}
                                </span>
                                {canCancel && (
                                  <button
                                    onClick={() => {
                                      setCancelItemTarget({
                                        pedidoId: item._pedidoId,
                                        itemIndex: item._itemIndex,
                                        name,
                                      });
                                      setCancelItemReason("");
                                    }}
                                    className="flex h-6 w-6 items-center justify-center rounded border border-red-500/25 text-red-500/50 hover:border-red-500/60 hover:text-red-400"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 02 Ajustes y notas */}
                    <div className="mt-8 space-y-1">
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                        02 Ajustes y notas
                      </p>

                      {/* A1 Descuento / Ajuste */}
                      <div className="rounded-lg border border-white/10">
                        <button
                          onClick={() => setShowDiscountAccordion((v) => !v)}
                          className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-zinc-400 hover:text-white"
                        >
                          <span>A1 · Descuento / Ajuste</span>
                          <Plus
                            size={14}
                            className={`transition-transform duration-150 ${showDiscountAccordion ? "rotate-45" : ""}`}
                          />
                        </button>
                        {showDiscountAccordion && (
                          <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-2">
                            <select
                              value={discountType}
                              onChange={(e) => setDiscountType(e.target.value as CashierDiscountType)}
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none"
                            >
                              <option value="none" className="bg-zinc-900">Sin descuento</option>
                              <option value="fixed" className="bg-zinc-900">Descuento fijo</option>
                              <option value="percentage" className="bg-zinc-900">Descuento %</option>
                            </select>
                            <input
                              value={discountValue}
                              onChange={(e) => setDiscountValue(e.target.value)}
                              type="number"
                              min={0}
                              placeholder="Valor del descuento"
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                            <input
                              value={discountReason}
                              onChange={(e) => setDiscountReason(e.target.value)}
                              placeholder="Motivo obligatorio si hay descuento"
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                            <input
                              value={manualExtraAmount}
                              onChange={(e) => setManualExtraAmount(e.target.value)}
                              type="number"
                              min={0}
                              placeholder="Extra manual opcional"
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                            <input
                              value={manualExtraReason}
                              onChange={(e) => setManualExtraReason(e.target.value)}
                              placeholder="Motivo del extra"
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                            <button
                              onClick={saveAdjustments}
                              disabled={processing || !isOnline}
                              className="h-10 w-full rounded-lg bg-white/10 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50"
                            >
                              Guardar ajustes
                            </button>
                          </div>
                        )}
                      </div>

                      {/* A2 Dividir cuenta */}
                      <div className="rounded-lg border border-white/10">
                        <button
                          onClick={() => setShowSplitBill((v) => !v)}
                          className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-zinc-400 hover:text-white"
                        >
                          <span>A2 · Dividir cuenta</span>
                          <Plus
                            size={14}
                            className={`transition-transform duration-150 ${showSplitBill ? "rotate-45" : ""}`}
                          />
                        </button>
                        {showSplitBill && (
                          <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-3">
                            {/* Mode tabs */}
                            <div className="flex rounded-lg border border-white/15 p-0.5">
                              {(["partes", "productos"] as const).map((mode) => (
                                <button
                                  key={mode}
                                  onClick={() => { setSplitMode(mode); setSplitProductSelection({}); }}
                                  className={`flex-1 rounded-md py-1.5 text-xs font-bold transition ${splitMode === mode ? "bg-white text-zinc-950" : "text-zinc-500 hover:text-zinc-200"}`}
                                >
                                  {mode === "partes" ? "Por partes iguales" : "Por productos"}
                                </button>
                              ))}
                            </div>

                            {/* Partial payments progress */}
                            {(selectedCuenta.payments?.length ?? 0) > 0 && (
                              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
                                <p className="text-xs font-semibold text-emerald-400">
                                  Cobrado: {formatPriceARS(paidTotal)} · Saldo: {formatPriceARS(remainingAmount)}
                                </p>
                                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-emerald-900">
                                  <div
                                    className="h-full rounded-full bg-emerald-400 transition-all"
                                    style={{ width: `${Math.min(100, (paidTotal / finalTotal) * 100)}%` }}
                                  />
                                </div>
                              </div>
                            )}

                            {/* Por partes */}
                            {splitMode === "partes" && (
                              <div className="space-y-2">
                                <div className="flex items-center gap-3">
                                  <label className="text-sm text-zinc-400">Dividir entre</label>
                                  <input
                                    type="number"
                                    min={2}
                                    max={20}
                                    value={splitParts}
                                    onChange={(e) => setSplitParts(e.target.value)}
                                    className="h-9 w-20 rounded-lg border border-white/15 bg-white/5 px-3 text-center text-sm font-bold text-white outline-none"
                                  />
                                  <span className="text-sm text-zinc-400">personas</span>
                                </div>
                                {Number(splitParts) >= 2 && remainingAmount > 0 && (
                                  <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                                    <p className="text-xs text-zinc-500">Cada persona paga</p>
                                    <p className="text-2xl font-bold text-white">
                                      {formatPriceARS(Math.ceil(remainingAmount / Number(splitParts)))}
                                    </p>
                                    <p className="mt-1 text-xs text-zinc-600">
                                      {formatPriceARS(remainingAmount)} ÷ {splitParts} personas
                                    </p>
                                    <button
                                      onClick={() => setPaymentAmount(String(Math.ceil(remainingAmount / Number(splitParts))))}
                                      className="mt-2 w-full rounded-lg border border-white/15 bg-white/10 py-2 text-xs font-bold text-zinc-200 hover:bg-white/15"
                                    >
                                      Cobrar esta parte ({formatPriceARS(Math.ceil(remainingAmount / Number(splitParts)))})
                                    </button>
                                  </div>
                                )}
                                {remainingAmount <= 0 && (
                                  <p className="text-xs font-semibold text-emerald-400">Cuenta completamente cobrada.</p>
                                )}
                              </div>
                            )}

                            {/* Por productos */}
                            {splitMode === "productos" && (
                              <div className="space-y-2">
                                <p className="text-xs text-zinc-500">Seleccioná los productos a cobrar en esta parte:</p>
                                {selectedItems.filter((i) => !i._cancelled).flatMap((item) => {
                                  const itemKey = `${item._pedidoId}:${item._itemIndex}`;
                                  const qty = getItemQuantity(item as CashierOrderItem);
                                  const itemSubtotal = getItemSubtotal(item as CashierOrderItem);
                                  const unitPrice = qty > 0 ? itemSubtotal / qty : 0;
                                  const name = getItemName(item as CashierOrderItem);
                                  return Array.from({ length: qty }, (_, unitIdx) => {
                                    const key = `${itemKey}:${unitIdx}`;
                                    const paid = !!splitPaidKeys[key];
                                    const checked = !paid && !!splitProductSelection[key];
                                    return (
                                      <label
                                        key={key}
                                        className={`flex items-center justify-between rounded-lg border px-3 py-2 ${paid ? "cursor-default border-white/5 opacity-40" : "cursor-pointer border-white/10 hover:border-white/20"}`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="checkbox"
                                            checked={checked}
                                            disabled={paid}
                                            onChange={(e) =>
                                              !paid && setSplitProductSelection((prev) => ({ ...prev, [key]: e.target.checked }))
                                            }
                                            className="h-4 w-4 accent-white disabled:cursor-not-allowed"
                                          />
                                          <span className={`text-sm font-semibold ${paid ? "line-through text-zinc-600" : "text-zinc-200"}`}>
                                            {name}{qty > 1 ? ` (${unitIdx + 1}/${qty})` : ""}
                                          </span>
                                          {paid && <span className="text-xs text-zinc-600">Ya cobrado</span>}
                                        </div>
                                        <span className={`text-sm font-bold ${paid ? "text-zinc-600" : "text-zinc-300"}`}>
                                          {formatPriceARS(unitPrice)}
                                        </span>
                                      </label>
                                    );
                                  });
                                })}
                                {splitProductSubtotal > 0 && (
                                  <div className="rounded-lg border border-white/15 bg-white/5 px-4 py-3">
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-semibold text-zinc-400">Subtotal selección</span>
                                      <span className="text-lg font-bold text-white">{formatPriceARS(splitProductSubtotal)}</span>
                                    </div>
                                    <button
                                      onClick={() => {
                                        const keysBeingPaid = Object.keys(splitProductSelection).filter((k) => splitProductSelection[k]);
                                        setSplitPaidKeys((prev) => {
                                          const next = { ...prev };
                                          for (const k of keysBeingPaid) next[k] = true;
                                          return next;
                                        });
                                        setPaymentAmount(String(Math.round(splitProductSubtotal)));
                                        setSplitProductSelection({});
                                      }}
                                      className="mt-2 w-full rounded-lg bg-white/15 py-2 text-xs font-bold text-white hover:bg-white/20"
                                    >
                                      Cobrar esta selección ({formatPriceARS(splitProductSubtotal)})
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* A3 Nota interna */}
                      <div className="rounded-lg border border-white/10">
                        <button
                          onClick={() => setShowNotaAccordion((v) => !v)}
                          className="flex w-full items-center justify-between px-4 py-3 text-sm font-bold text-zinc-400 hover:text-white"
                        >
                          <span>A3 · Nota interna</span>
                          <Plus
                            size={14}
                            className={`transition-transform duration-150 ${showNotaAccordion ? "rotate-45" : ""}`}
                          />
                        </button>
                        {showNotaAccordion && (
                          <div className="border-t border-white/10 px-4 pb-4 pt-3 space-y-2">
                            <div className="flex gap-2">
                              <input
                                value={internalNote}
                                onChange={(e) => setInternalNote(e.target.value)}
                                placeholder="Ej: cliente VIP, no cobrar cubierto..."
                                className="h-10 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                              />
                              <button
                                onClick={handleSaveInternalNote}
                                disabled={processing}
                                className="h-10 rounded-lg border border-white/15 bg-white/10 px-4 text-xs font-bold text-zinc-300 hover:bg-white/15 disabled:opacity-50"
                              >
                                Guardar
                              </button>
                            </div>
                            {selectedCuenta.internalNote && (
                              <p className="text-xs text-zinc-500">
                                Nota actual: <span className="font-semibold text-zinc-300">{selectedCuenta.internalNote}</span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── RIGHT: Summary + Payment ─────────── */}
                  <div className="p-6 space-y-6">

                    {/* Saldo a cobrar */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-lime-400" />
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
                          Saldo a cobrar
                        </span>
                        <span className="ml-auto text-xs font-bold text-zinc-600">ARS</span>
                      </div>
                      <p className="mt-2 text-[3.5rem] font-bold leading-none tracking-tight text-white">
                        {formatPriceARS(remainingAmount)}
                      </p>
                      <div className="mt-4 space-y-2.5">
                        <div className="flex justify-between text-sm">
                          <span className="text-zinc-500">Subtotal</span>
                          <span className="font-semibold text-zinc-300">{formatPriceARS(realSubtotal)}</span>
                        </div>
                        {discountAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Descuento</span>
                            <span className="font-semibold text-red-400">−{formatPriceARS(discountAmount)}</span>
                          </div>
                        )}
                        {twoForOneDiscount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">2×1</span>
                            <span className="font-semibold text-red-400">−{formatPriceARS(twoForOneDiscount)}</span>
                          </div>
                        )}
                        {extraAmount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Extras</span>
                            <span className="font-semibold text-zinc-300">+{formatPriceARS(extraAmount)}</span>
                          </div>
                        )}
                        {paidTotal > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-zinc-500">Pagado</span>
                            <span className="font-semibold text-emerald-400">−{formatPriceARS(paidTotal)}</span>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-white/10 pt-2.5">
                          <span className="text-xs font-bold uppercase tracking-wide text-zinc-500">Total final</span>
                          <span className="font-bold text-white">{formatPriceARS(finalTotal)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 03 Registrar pago */}
                    <div>
                      <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                        03 Registrar pago
                      </p>

                      {/* Method buttons */}
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            ["cash", "Efectivo"],
                            ["debit", "Débito"],
                            ["credit", "Crédito"],
                            ["transfer", "Transfer."],
                            ["mercado_pago", "M.Pago"],
                            ["mixed", "Mixto"],
                          ] as [CashierPaymentMethod, string][]
                        ).map(([m, label]) => (
                          <button
                            key={m}
                            onClick={() => { setPaymentMethod(m); setCashReceived(""); }}
                            className={`rounded-lg border py-2.5 text-xs font-bold transition ${
                              paymentMethod === m
                                ? "border-white/40 bg-white text-zinc-950"
                                : "border-white/10 bg-white/5 text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      {/* Amount + quick buttons */}
                      <div className="mt-3 space-y-2">
                        <input
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          type="number"
                          min={0.01}
                          placeholder="$ 0,00"
                          className={`h-12 w-full rounded-lg border bg-white/5 px-4 text-lg font-bold text-white placeholder-zinc-600 outline-none focus:ring-1 focus:ring-white/20 ${
                            isPaymentAmountInvalid ? "border-red-500/50" : "border-white/15"
                          }`}
                        />
                        <div className="grid grid-cols-4 gap-1.5">
                          {[2000, 5000, 10000].map((v) => (
                            <button
                              key={v}
                              onClick={() => setPaymentAmount(String((Number(paymentAmount) || 0) + v))}
                              className="rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-bold text-zinc-400 hover:border-white/20 hover:text-zinc-200"
                            >
                              +{v >= 1000 ? `${v / 1000}k` : v}
                            </button>
                          ))}
                          <button
                            onClick={() => { setPaymentAmount(String(remainingAmount)); setCashReceived(""); }}
                            className="rounded-lg border border-white/20 bg-white/10 py-2 text-xs font-bold text-zinc-200 hover:bg-white/15"
                          >
                            Exacto
                          </button>
                        </div>
                      </div>

                      {/* Cash change */}
                      {paymentMethod === "cash" && Number(paymentAmount) >= remainingAmount && remainingAmount > 0 && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div>
                            <label className="mb-1 block text-xs font-semibold text-zinc-500">Efectivo recibido</label>
                            <input
                              value={cashReceived}
                              onChange={(e) => setCashReceived(e.target.value)}
                              type="number"
                              min={Number(paymentAmount)}
                              placeholder={formatPriceARS(Number(paymentAmount))}
                              className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                            />
                          </div>
                          <div
                            className={`flex flex-col justify-center rounded-lg border px-3 py-1 ${
                              Number(cashReceived) >= Number(paymentAmount)
                                ? "border-emerald-500/30 bg-emerald-500/10"
                                : "border-white/10 bg-white/5"
                            }`}
                          >
                            <p className="text-xs text-zinc-500">Dar de vuelto</p>
                            <p className={`text-xl font-bold ${Number(cashReceived) >= Number(paymentAmount) ? "text-emerald-400" : "text-zinc-600"}`}>
                              {Number(cashReceived) >= Number(paymentAmount)
                                ? formatPriceARS(Number(cashReceived) - Number(paymentAmount))
                                : "—"}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Propina */}
                      {selectedCuenta.estado !== "pagada" && (
                        <div className="mt-3 flex items-center gap-3">
                          <label className="text-xs text-zinc-500 shrink-0">Propina (opcional)</label>
                          <input
                            value={tipAmount}
                            onChange={(e) => setTipAmount(e.target.value)}
                            type="number"
                            min={0}
                            placeholder="$ 0"
                            className="h-9 w-28 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                          />
                          {Number(tipAmount) > 0 && (
                            <span className="text-xs font-semibold text-emerald-400">
                              +{formatPriceARS(Number(tipAmount))}
                            </span>
                          )}
                        </div>
                      )}
                      {selectedCuenta.tip != null && selectedCuenta.tip > 0 && (
                        <p className="mt-1 text-xs font-semibold text-emerald-500">
                          Propina registrada: {formatPriceARS(selectedCuenta.tip)}
                        </p>
                      )}

                      {/* Payments already made */}
                      {selectedCuenta.payments && selectedCuenta.payments.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                          {selectedCuenta.payments.map((payment) => (
                            <div
                              key={payment.id}
                              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2"
                            >
                              <span className="text-sm font-semibold text-zinc-400">
                                {paymentLabels[payment.method] || payment.method}
                              </span>
                              <span className="font-bold text-zinc-200">{formatPriceARS(payment.amount)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Warnings */}
                      {isPaymentAmountInvalid && selectedCuenta.estado !== "pagada" && (
                        <p className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-400">
                          Ingresá un monto mayor a cero.
                        </p>
                      )}
                      {!isPaymentAmountInvalid && currentPaymentAmount < remainingAmount && selectedCuenta.estado !== "pagada" && (
                        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-400">
                          Pago parcial — quedará un saldo de {formatPriceARS(remainingAmount - currentPaymentAmount)}.
                        </p>
                      )}

                      {/* COBRAR button */}
                      <button
                        onClick={handleMarkPaid}
                        disabled={
                          processing ||
                          !isOnline ||
                          selectedCuenta.estado === "pagada" ||
                          isPaymentAmountInvalid
                        }
                        className="mt-4 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#b5f23d] font-bold text-zinc-950 text-lg transition hover:bg-[#c8ff50] disabled:opacity-40"
                      >
                        <Wallet size={20} />
                        COBRAR AHORA · {formatPriceARS(Number(paymentAmount) || remainingAmount)}
                      </button>

                      {/* Invoice */}
                      {selectedCuenta.estado !== "pagada" && !selectedCuenta.invoice?.status && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setShowInvoiceInline((v) => !v)}
                            className="flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-300"
                          >
                            <span
                              className={`flex h-4 w-4 items-center justify-center rounded border text-xs ${
                                showInvoiceInline
                                  ? "border-zinc-400 bg-zinc-400 text-zinc-950"
                                  : "border-zinc-600"
                              }`}
                            >
                              {showInvoiceInline ? "✓" : ""}
                            </span>
                            ¿El cliente necesita factura?
                          </button>
                          {showInvoiceInline && (
                            <div className="mt-3 grid gap-2 rounded-lg border border-white/10 bg-white/5 p-3 sm:grid-cols-2">
                              <select
                                value={invoiceType}
                                onChange={(e) => setInvoiceType(e.target.value as "A" | "B" | "C" | "ticket")}
                                className="h-10 rounded-lg border border-white/15 bg-zinc-900 px-3 text-sm text-white"
                              >
                                <option value="ticket">Ticket / comprobante</option>
                                <option value="A">Factura A</option>
                                <option value="B">Factura B</option>
                                <option value="C">Factura C</option>
                              </select>
                              <input
                                value={invoiceCustomerName}
                                onChange={(e) => setInvoiceCustomerName(e.target.value)}
                                placeholder="Nombre / Razón social"
                                className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                              />
                              <select
                                value={invoiceDocumentType}
                                onChange={(e) => setInvoiceDocumentType(e.target.value as "DNI" | "CUIT" | "CUIL" | "PASSPORT")}
                                className="h-10 rounded-lg border border-white/15 bg-zinc-900 px-3 text-sm text-white"
                              >
                                <option value="DNI">DNI</option>
                                <option value="CUIT">CUIT</option>
                                <option value="CUIL">CUIL</option>
                                <option value="PASSPORT">Pasaporte</option>
                              </select>
                              <div className="flex flex-col gap-1">
                                <input
                                  value={invoiceDocumentNumber}
                                  onChange={(e) => setInvoiceDocumentNumber(e.target.value)}
                                  placeholder="Número de documento"
                                  className={`h-10 rounded-lg border px-3 text-sm text-white bg-white/5 placeholder-zinc-600 outline-none ${cuitError ? "border-red-500/60" : "border-white/15"}`}
                                />
                                {cuitError && (
                                  <p className="text-xs text-red-400 font-medium">CUIT inválido — verificá los 11 dígitos</p>
                                )}
                              </div>
                              <input value={invoiceIvaCondition} onChange={(e) => setInvoiceIvaCondition(e.target.value)} placeholder="Condición IVA" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <input value={invoiceFiscalRegime} onChange={(e) => setInvoiceFiscalRegime(e.target.value)} placeholder="Régimen fiscal" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <input value={invoiceFiscalAddress} onChange={(e) => setInvoiceFiscalAddress(e.target.value)} placeholder="Dirección fiscal" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <input value={invoicePostalCode} onChange={(e) => setInvoicePostalCode(e.target.value)} placeholder="Código postal" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <input value={invoiceProvince} onChange={(e) => setInvoiceProvince(e.target.value)} placeholder="Provincia" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <input value={invoiceCity} onChange={(e) => setInvoiceCity(e.target.value)} placeholder="Localidad" className="h-10 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none" />
                              <div className="col-span-full flex flex-col gap-1">
                                <label className="text-xs font-bold text-zinc-400">
                                  Email del cliente <span className="text-red-400">*</span>
                                  <span className="ml-1 font-normal text-zinc-600">— se envía la factura electrónica automáticamente</span>
                                </label>
                                <input
                                  value={invoiceEmail}
                                  onChange={(e) => setInvoiceEmail(e.target.value)}
                                  type="email"
                                  placeholder="cliente@email.com"
                                  className="h-10 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white placeholder-zinc-600 outline-none"
                                />
                              </div>
                              <button
                                onClick={handleRequestInvoice}
                                disabled={processing || !isOnline || !!cuitError}
                                className="col-span-full h-10 rounded-lg bg-white/10 text-sm font-bold text-white hover:bg-white/15 disabled:opacity-50"
                              >
                                Guardar solicitud de factura
                              </button>
                              {selectedCuenta.invoice?.status === "issued" && selectedCuenta.invoice.cae ? (
                                <div className="col-span-full rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                                  <p className="text-xs font-bold text-emerald-400 uppercase tracking-wide">Factura emitida ✓</p>
                                  <p className="mt-1 font-mono text-xs text-emerald-300">
                                    {selectedCuenta.invoice.invoiceType} N° {String(selectedCuenta.invoice.invoiceNumber).padStart(8, "0")}
                                  </p>
                                  <p className="mt-0.5 font-mono text-xs text-emerald-400">CAE: {selectedCuenta.invoice.cae}</p>
                                  <p className="mt-0.5 text-xs text-emerald-500">Vence: {selectedCuenta.invoice.caeExpiry}</p>
                                </div>
                              ) : selectedCuenta.invoice?.status === "requested" ? (
                                <p className="col-span-full text-sm font-semibold text-amber-400">Solicitud de factura pendiente</p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Reabrir cuenta */}
                      {selectedCuenta.estado === "pagada" && (
                        <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                          {!showReopenModal ? (
                            <button
                              onClick={() => setShowReopenModal(true)}
                              className="text-sm font-semibold text-amber-400 hover:underline"
                            >
                              ¿Error de cobro? Reabrir cuenta
                            </button>
                          ) : (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-amber-400">Motivo de reapertura (obligatorio)</p>
                              <input
                                value={reopenReason}
                                onChange={(e) => setReopenReason(e.target.value)}
                                placeholder="Ej: error en método de pago, monto incorrecto..."
                                className="h-9 w-full rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-sm text-amber-200 placeholder-amber-700 outline-none"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={handleReopenBill}
                                  disabled={processing}
                                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-zinc-950 disabled:opacity-50"
                                >
                                  Reabrir
                                </button>
                                <button
                                  onClick={() => { setShowReopenModal(false); setReopenReason(""); }}
                                  className="rounded-lg border border-amber-500/30 px-4 py-1.5 text-xs font-semibold text-amber-400"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </div>

    {/* Add product modal */}
    {showAddProductModal && selectedCuenta && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#1a1a1a] p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-white">Agregar producto</h2>
            <button
              onClick={() => { setShowAddProductModal(false); setAddSelectedMenuId(""); setAddQuantity("1"); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-zinc-400 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <select
              value={addSelectedMenuId}
              onChange={(e) => setAddSelectedMenuId(e.target.value)}
              className="h-12 w-full rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none"
            >
              <option value="" className="bg-zinc-900">Seleccionar producto</option>
              {menuItems.map((item) => (
                <option key={item.id} value={item.id} className="bg-zinc-900">
                  {item.name} · {formatPriceARS(item.price)}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-3">
              <label className="text-sm text-zinc-400 shrink-0">Cantidad</label>
              <input
                value={addQuantity}
                onChange={(e) => setAddQuantity(e.target.value)}
                type="number"
                min={1}
                className="h-10 w-24 rounded-lg border border-white/15 bg-white/5 px-3 text-sm text-white outline-none"
              />
            </div>
            <button
              onClick={async () => {
                await addItemToSelectedBill();
                setShowAddProductModal(false);
              }}
              disabled={processing || !isOnline}
              className="h-12 w-full rounded-xl bg-[#b5f23d] font-bold text-zinc-950 transition hover:bg-[#c8ff50] disabled:opacity-50"
            >
              Confirmar
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Opening cash dialog */}
    {showOpeningDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="text-2xl font-bold text-zinc-950">Apertura de caja</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Ingresá el monto inicial en efectivo que tenés en la caja.
          </p>
          <input
            value={openingCashInput}
            onChange={(e) => setOpeningCashInput(e.target.value)}
            type="number"
            min={0}
            placeholder="$0"
            className="mt-4 h-14 w-full rounded-lg border border-zinc-200 px-4 text-xl font-bold outline-none focus:ring-2 focus:ring-black/10"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && void confirmOpeningCash()}
            disabled={openingCaja}
          />
          <button
            onClick={() => void confirmOpeningCash()}
            disabled={openingCaja}
            className="mt-3 h-12 w-full rounded-lg bg-zinc-950 font-bold text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            {openingCaja ? "Abriendo..." : "Abrir caja"}
          </button>
          <button
            onClick={() => void confirmOpeningCash(0)}
            disabled={openingCaja}
            className="mt-2 w-full rounded-xl py-2 text-sm font-bold text-zinc-400 transition hover:text-zinc-600 disabled:opacity-50"
          >
            Continuar sin ingresar monto
          </button>
        </div>
      </div>
    )}

    {/* Cierre de caja modal */}
    {showCierreModal && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
          <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
            <div>
              <h2 className="text-xl font-bold text-zinc-950">Cierre de caja</h2>
              {cashSession && (
                <p className="mt-0.5 text-xs text-zinc-500">
                  Apertura:{" "}
                  {new Intl.DateTimeFormat("es-AR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(cashSession.openedAt))}
                  {" · "}Monto inicial: <strong>{formatPriceARS(cashSession.openingCash)}</strong>
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportCierre}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs font-bold text-zinc-700 hover:bg-zinc-100"
              >
                <Printer size={13} /> Exportar PDF
              </button>
              <button
                onClick={() => setShowCierreModal(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="space-y-6 p-6">
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Monto inicial
                </p>
                <p className="mt-1 text-2xl font-bold text-zinc-950">
                  {formatPriceARS(cashSession?.openingCash ?? 0)}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                  Efectivo en caja
                </p>
                <p className="mt-1 text-2xl font-bold text-emerald-900">
                  {formatPriceARS(totalCajaActual)}
                </p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  Total recaudado
                </p>
                <p className="mt-1 text-2xl font-bold text-blue-900">
                  {formatPriceARS(totalRecaudado)}
                </p>
              </div>
            </div>

            {/* F-012: Total propinas */}
            {totalTips > 0 && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Propinas totales</p>
                <p className="mt-1 text-xl font-bold text-emerald-900">{formatPriceARS(totalTips)}</p>
              </div>
            )}

            {/* Breakdown by payment method */}
            <div>
              <h3 className="mb-3 text-base font-bold text-zinc-950">
                Por forma de pago
              </h3>
              {Object.keys(paymentBreakdown).length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No hay cuentas cobradas en este turno.
                </p>
              ) : (
                <div className="space-y-2">
                  {(
                    Object.entries(paymentBreakdown) as [
                      CashierPaymentMethod,
                      { count: number; total: number },
                    ][]
                  )
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([method, data]) => (
                      <div
                        key={method}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-950">
                            {paymentLabels[method] || method}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-600">
                            {data.count} cuenta{data.count !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="text-base font-bold text-zinc-950">
                          {formatPriceARS(data.total)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* List of paid cuentas */}
            {paidCuentasToday.length > 0 && (
              <div>
                <h3 className="mb-3 text-base font-bold text-zinc-950">
                  Cuentas cobradas ({paidCuentasToday.length})
                </h3>
                <div className="space-y-2">
                  {paidCuentasToday.map((cuenta) => {
                    const method =
                      cuenta.payments?.[0]?.method ??
                      (cuenta.metodo as CashierPaymentMethod) ??
                      "other";
                    return (
                      <div
                        key={cuenta.id}
                        className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-zinc-950">
                            Mesa {cuenta.mesa}
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-bold text-zinc-600">
                            {paymentLabels[method] || method}
                          </span>
                        </div>
                        <span className="text-sm font-bold text-zinc-950">
                          {formatPriceARS(
                            cuenta.paidAmount != null && cuenta.paidAmount > 0
                              ? cuenta.paidAmount
                              : Number(cuenta.total || 0)
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {/* Manual adjustments */}
            <div>
              <h3 className="mb-3 text-base font-bold text-zinc-950">
                Ajustes de caja
              </h3>

              {!adjustForm ? (
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setAdjustForm({ type: "add", amount: "", reason: "" })
                    }
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100"
                  >
                    + Agregar monto
                  </button>
                  <button
                    onClick={() =>
                      setAdjustForm({ type: "deduct", amount: "", reason: "" })
                    }
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 text-sm font-bold text-red-700 transition hover:bg-red-100"
                  >
                    − Descontar monto
                  </button>
                </div>
              ) : (
                <div
                  className={`rounded-lg border p-4 ${
                    adjustForm.type === "add"
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <p className="mb-3 text-sm font-bold text-zinc-950">
                    {adjustForm.type === "add" ? "Agregar monto" : "Descontar monto"}
                  </p>
                  <div className="space-y-2">
                    <input
                      type="number"
                      min={0}
                      placeholder="Monto"
                      value={adjustForm.amount}
                      onChange={(e) =>
                        setAdjustForm((f) => f && { ...f, amount: e.target.value })
                      }
                      className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-black/10"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Motivo (obligatorio)"
                      value={adjustForm.reason}
                      onChange={(e) =>
                        setAdjustForm((f) => f && { ...f, reason: e.target.value })
                      }
                      className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-black/10"
                      onKeyDown={(e) => e.key === "Enter" && void saveAdjustment()}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => void saveAdjustment()}
                        disabled={
                          !adjustForm.amount ||
                          Number(adjustForm.amount) <= 0 ||
                          !adjustForm.reason.trim()
                        }
                        className={`h-10 flex-1 rounded-xl font-bold text-sm text-white transition disabled:opacity-40 ${
                          adjustForm.type === "add"
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-red-600 hover:bg-red-700"
                        }`}
                      >
                        Confirmar
                      </button>
                      <button
                        onClick={() => setAdjustForm(null)}
                        className="h-10 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-bold text-zinc-600 transition hover:bg-zinc-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {(cashSession?.adjustments ?? []).length > 0 && (
                <div className="mt-3 space-y-2">
                  {cashSession!.adjustments!.map((adj) => (
                    <div
                      key={adj.id}
                      className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                        adj.type === "add"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-red-200 bg-red-50"
                      }`}
                    >
                      <div>
                        <span
                          className={`text-sm font-bold ${
                            adj.type === "add" ? "text-emerald-800" : "text-red-800"
                          }`}
                        >
                          {adj.type === "add" ? "+" : "−"}{" "}
                          {formatPriceARS(adj.amount)}
                        </span>
                        <p className="mt-0.5 text-xs text-zinc-500">{adj.reason}</p>
                      </div>
                      <span className="text-xs text-zinc-400">
                        {new Intl.DateTimeFormat("es-AR", {
                          timeStyle: "short",
                        }).format(new Date(adj.createdAt))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* Arqueo real */}
            <div>
              <h3 className="mb-2 text-base font-bold text-zinc-950">Arqueo real <span className="text-sm font-normal text-zinc-400">(opcional)</span></h3>
              <p className="mb-3 text-xs text-zinc-500">
                Ingresá el efectivo físicamente contado en la caja para registrar la diferencia con el arqueo esperado (<strong>{formatPriceARS(totalCajaActual)}</strong>).
              </p>
              <input
                type="number"
                min={0}
                placeholder="Efectivo contado en caja..."
                value={cajaArqueoRealInput}
                onChange={(e) => setCajaArqueoRealInput(e.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold outline-none focus:ring-2 focus:ring-black/10"
              />
              {cajaArqueoRealInput.trim() !== "" && !isNaN(Number(cajaArqueoRealInput)) && (
                <div
                  className={`mt-2 rounded-lg px-4 py-2.5 text-sm font-bold ${
                    Number(cajaArqueoRealInput) - totalCajaActual >= 0
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                >
                  Diferencia: {formatPriceARS(Number(cajaArqueoRealInput) - totalCajaActual)}
                </div>
              )}
            </div>

            {/* Close register */}
            <div className="border-t border-zinc-200 pt-4">
              <button
                onClick={handleCierreCaja}
                disabled={closingCaja}
                className="h-13 w-full rounded-lg bg-zinc-950 font-bold text-white transition hover:bg-zinc-800 disabled:opacity-50 py-3"
              >
                {closingCaja ? "Registrando cierre..." : "Cerrar caja y registrar auditoría"}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    {/* F-008/FC-004: Modal confirmación cancelación de ítem */}
    {cancelItemTarget && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="mb-1 text-base font-bold text-zinc-950">
            Cancelar ítem
          </h3>
          <p className="mb-4 text-sm text-zinc-500">
            Vas a cancelar <span className="font-semibold text-zinc-800">"{cancelItemTarget.name}"</span>. Esta acción se registra en el audit log.
          </p>
          <label className="mb-1 block text-xs font-semibold text-zinc-600">
            Motivo (obligatorio)
          </label>
          <input
            value={cancelItemReason}
            onChange={(e) => setCancelItemReason(e.target.value)}
            placeholder="Ej: error de pedido, cliente cambió de opinión..."
            className="mb-4 h-10 w-full rounded-lg border border-zinc-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              onClick={handleCancelItem}
              disabled={processing || cancelItemReason.trim().length < 3}
              className="flex-1 rounded-lg bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-40 hover:bg-red-700"
            >
              {processing ? "Cancelando..." : "Confirmar cancelación"}
            </button>
            <button
              onClick={() => { setCancelItemTarget(null); setCancelItemReason(""); }}
              className="rounded-lg border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-600 hover:bg-zinc-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Cashier;
