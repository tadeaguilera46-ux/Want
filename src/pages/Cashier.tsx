import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
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
} from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { getDb } from "../lib/firebase";
import { useAuth } from "../lib/auth-context";
import { useRestaurant } from "../lib/restaurant-context";
import { crearPedido } from "../lib/orders";
import {
  createCashierAuditLog,
  createOrRefreshCashierBill,
  markCashierBillPrinted,
  registerCashierPayment,
  requestCashierInvoice,
  updateCashierBillAdjustments,
} from "../lib/cashier";
import type { MetodoPago, PedidoItem } from "../lib/restaurant";
import type {
  CashierDiscountType,
  CashierPaymentMethod,
} from "../types/cashier";

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
  unpaid?: boolean;
  unpaidReason?: string;
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
  };
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
};

type Pedido = {
  id: string;
  restaurantId: string;
  mesa: number;
  sessionId?: string;
  total: number;
  items: CashierOrderItem[];
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

const Cashier = () => {
  const [searchParams] = useSearchParams();
  const { restaurantId: contextRestaurantId } = useRestaurant();
  const { user, logout } = useAuth();
  const isOnline = useOnlineStatus();

  const restaurantId =
    contextRestaurantId || searchParams.get("restaurantId") || "";

  const invoiceRequestsPath = `/staff/cashier/invoices?restaurantId=${encodeURIComponent(
    restaurantId
  )}`;

  const [sessions, setSessions] = useState<Session[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [orders, setOrders] = useState<Pedido[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);

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

  const [paymentMethod, setPaymentMethod] =
    useState<CashierPaymentMethod>("cash");
  const [paymentAmount, setPaymentAmount] = useState("");

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
  const [invoiceEmail, setInvoiceEmail] = useState("");
  const [invoiceIvaCondition, setInvoiceIvaCondition] = useState("");
  const [invoiceFiscalRegime, setInvoiceFiscalRegime] = useState("");
  const [invoiceFiscalAddress, setInvoiceFiscalAddress] = useState("");
  const [invoicePostalCode, setInvoicePostalCode] = useState("");
  const [invoiceProvince, setInvoiceProvince] = useState("");
  const [invoiceCity, setInvoiceCity] = useState("");

  const [showOpeningDialog, setShowOpeningDialog] = useState(true);
  const [openingCashInput, setOpeningCashInput] = useState("");
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

  const sessionKey = restaurantId
    ? `cashier_session_${restaurantId}_${new Date().toISOString().slice(0, 10)}`
    : null;

  useEffect(() => {
    if (!restaurantId) return;

    const q = query(collection(db, "restaurants", restaurantId, "sessions"));

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

  useEffect(() => {
    if (!sessionKey) return;
    const stored = localStorage.getItem(sessionKey);
    if (stored) {
      try {
        setCashSession(JSON.parse(stored));
      } catch {
        // ignore malformed data
      }
    }
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

    setPaymentAmount(String(Number(selectedCuenta.total || 0)));

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
  }, [selectedCuenta?.id]);

  const selectedOrders = useMemo(() => {
    if (!selectedCuenta) return [];

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
    return selectedOrders.flatMap((order) => order.items || []);
  }, [selectedOrders]);

  const realSubtotal = useMemo(() => {
    if (!selectedCuenta) return 0;

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

  const extraAmount = useMemo(() => {
    const value = Number(manualExtraAmount || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }, [manualExtraAmount]);

  const finalTotal = useMemo(() => {
    return Math.max(0, realSubtotal - discountAmount + extraAmount);
  }, [realSubtotal, discountAmount, extraAmount]);

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
    !Number.isFinite(currentPaymentAmount) ||
    currentPaymentAmount <= 0 ||
    currentPaymentAmount < remainingAmount;

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
      const cuentaRef = await addDoc(
        collection(db, "restaurants", restaurantId, "cuentas"),
        {
          restaurantId,
          mesa,
          total: manualTotal,
          sessionId: null,
          estado: "pendiente",
          metodo: null,
          splitBill: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );

      await createCashierAuditLog({
        restaurantId,
        action: "cashier_bill_created",
        actorUid: user.uid,
        actorEmail: user.email,
        mesa,
        cuentaId: cuentaRef.id,
        metadata: { total: manualTotal, source: "manual" },
      });

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
    if (!isOnline) {
      toast.error("Sin conexión.");
      return;
    }
    if (!user || !restaurantId || !selectedCuenta) return;

    try {
      setProcessing(true);
      setError(null);

      const amount = Number(paymentAmount);

      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Monto de pago inválido.");
      }

      if (amount < remainingAmount) {
        throw new Error(
          `El monto pagado no puede ser menor al saldo pendiente. Faltan ${formatPriceARS(
            remainingAmount - amount
          )}.`
        );
      }

      await registerCashierPayment({
        restaurantId,
        cuentaId: selectedCuenta.id,
        mesa: Number(selectedCuenta.mesa),
        metodo: cashierMethodToMetodoPago(paymentMethod),
        actorUid: user.uid,
        actorEmail: user.email,
        payments: [
          {
            id: crypto.randomUUID(),
            method: paymentMethod,
            amount,
          },
        ],

      });

    } catch (err) {
      console.error("Error registrando pago:", err);
      setError(
        err instanceof Error ? err.message : "No se pudo registrar el pago."
      );
    } finally {
      setProcessing(false);
    }
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

      window.print();
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
    if (!invoiceIvaCondition.trim()) return alert("Ingresá la condición frente al IVA.");
    if (!invoiceFiscalAddress.trim()) return alert("Ingresá la dirección fiscal.");
    if (!invoicePostalCode.trim()) return alert("Ingresá el código postal.");

    try {
      setProcessing(true);
      setError(null);

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

  const confirmOpeningCash = (forcedAmount?: number) => {
    if (!sessionKey) return;
    const amount =
      forcedAmount !== undefined
        ? forcedAmount
        : Math.max(0, Number(openingCashInput) || 0);
    const session = {
      openingCash: amount,
      openedAt: Date.now(),
      adjustments: cashSession?.adjustments,
    };
    localStorage.setItem(sessionKey, JSON.stringify(session));
    setCashSession(session);
    setShowOpeningDialog(false);
  };

  const handleCierreCaja = async () => {
    if (!restaurantId || !cashSession) return;
    try {
      setClosingCaja(true);
      await addDoc(
        collection(db, "restaurants", restaurantId, "auditLogs"),
        {
          action: "cierre_caja",
          userUid: user?.uid ?? null,
          userEmail: user?.email ?? null,
          userRole: "cashier",
          description: `Cierre de caja · Monto inicial: ${formatPriceARS(cashSession.openingCash)} · Efectivo cobrado: ${formatPriceARS(totalEfectivo)} · Ajustes: +${formatPriceARS(totalAjustesAdd)} / −${formatPriceARS(totalAjustesDeduct)} · Efectivo final en caja: ${formatPriceARS(totalCajaActual)}`,
          montoInicial: cashSession.openingCash,
          efectivoCobrado: totalEfectivo,
          ajustesAdd: totalAjustesAdd,
          ajustesDeduct: totalAjustesDeduct,
          efectivoFinal: totalCajaActual,
          totalRecaudado,
          createdAt: serverTimestamp(),
        }
      );
      toast.success("Caja cerrada y registrada en auditoría.");
      setShowCierreModal(false);
    } catch (err) {
      console.error(err);
      toast.error("No se pudo registrar el cierre de caja.");
    } finally {
      setClosingCaja(false);
    }
  };

  const saveAdjustment = () => {
    if (!sessionKey || !cashSession || !adjustForm) return;
    const amount = Math.max(0, Number(adjustForm.amount) || 0);
    if (amount <= 0 || !adjustForm.reason.trim()) return;

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
    localStorage.setItem(sessionKey, JSON.stringify(updated));
    setCashSession(updated);
    setAdjustForm(null);
  };

  if (!restaurantId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100 p-6">
        <div className="rounded-3xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-black text-zinc-950">
            Falta restaurante activo
          </h1>
          <p className="mt-2 text-sm text-zinc-600">
            Entrá con una URL que tenga restaurantId.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="min-h-screen bg-zinc-100">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-500">
              WANT POS
            </p>
            <h1 className="mt-1 text-4xl font-black tracking-tight text-zinc-950">
              Caja
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Cuentas, cobros, descuentos, carga manual e impresión.
            </p>
            <div
              className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold border ${
                isOnline
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-red-50 text-red-700 border-red-200"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isOnline ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              {isOnline ? "Online" : "Offline"}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Pendientes
                </p>
                <p className="mt-1 text-3xl font-black text-zinc-950">
                  {pendingBills.length}
                </p>
              </div>

              <div className="rounded-3xl border border-zinc-200 bg-white px-5 py-4 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Sesiones activas
                </p>
                <p className="mt-1 text-3xl font-black text-zinc-950">
                  {activeBills.length}
                </p>
              </div>

              <Link
                to={invoiceRequestsPath}
                className="col-span-2 flex rounded-3xl border border-zinc-950 bg-zinc-950 px-5 py-4 text-white shadow-sm transition hover:bg-zinc-800 sm:col-span-1"
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-white/70">
                    Facturas
                  </p>
                  <p className="mt-1 text-3xl font-black">
                    {invoiceRequestsCount}
                  </p>
                  <p className="mt-1 text-xs font-bold text-white/70">
                    Ver solicitudes
                  </p>
                </div>
              </Link>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowCierreModal(true)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-300 bg-white px-5 font-black text-zinc-800 shadow-sm transition hover:bg-zinc-50 sm:flex-none"
              >
                <BarChart3 size={17} />
                Cierre de caja
              </button>

              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 font-bold text-zinc-500 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <LogOut size={16} />
                {loggingOut ? "Saliendo..." : "Cerrar sesión"}
              </button>
            </div>
          </div>
        </div>
        {!isOnline && (
          <div className="mb-5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
            Sin conexión. Estás viendo datos guardados localmente. Los cobros,
            facturas y modificaciones están deshabilitados hasta reconectar.
          </div>
        )}
        {error && (
          <div className="mb-5 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[390px_1fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Receipt size={20} />
                <h2 className="text-lg font-black text-zinc-950">
                  Cuentas activas
                </h2>
              </div>

              {loading ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                  Cargando cuentas...
                </div>
              ) : activeBills.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
                  <AlertTriangle className="mx-auto mb-3 text-zinc-400" />
                  <p className="font-semibold text-zinc-700">
                    No hay cuentas activas
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeBills.map((cuenta) => {
                    const selected = selectedCuenta?.id === cuenta.id;

                    return (
                      <button
                        key={cuenta.id}
                        onClick={() => setSelectedCuentaId(cuenta.id)}
                        className={`w-full rounded-3xl border p-4 text-left transition ${
                          selected
                            ? "border-zinc-950 bg-zinc-950 text-white"
                            : "border-zinc-200 bg-white hover:border-zinc-300"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p
                              className={`text-xs font-bold uppercase tracking-wide ${
                                selected ? "text-white/70" : "text-zinc-500"
                              }`}
                            >
                              Mesa
                            </p>
                            <h3 className="text-3xl font-black">
                              {cuenta.mesa}
                            </h3>
                            <p
                              className={`mt-1 text-xs font-semibold ${
                                selected ? "text-white/70" : "text-zinc-500"
                              }`}
                            >
                              {cuenta.estado}
                            </p>
                          </div>

                          <div className="text-right">
                            <p
                              className={`text-xs font-bold uppercase tracking-wide ${
                                selected ? "text-white/70" : "text-zinc-500"
                              }`}
                            >
                              Total
                            </p>
                            <p className="text-xl font-black">
                              {formatPriceARS(cuenta.total)}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Plus size={20} />
                <h2 className="text-lg font-black text-zinc-950">
                  Crear cuenta manual
                </h2>
              </div>

              <div className="space-y-3">
                <input
                  value={manualMesa}
                  onChange={(e) => setManualMesa(e.target.value)}
                  type="number"
                  min={1}
                  placeholder="Número de mesa"
                  className="h-12 w-full rounded-2xl border border-zinc-200 px-4 outline-none focus:ring-2 focus:ring-black/10"
                />

                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <select
                    value={manualSelectedMenuId}
                    onChange={(e) => setManualSelectedMenuId(e.target.value)}
                    className="h-12 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                  >
                    <option value="">Seleccionar producto</option>
                    {menuItems.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {formatPriceARS(item.price)}
                      </option>
                    ))}
                  </select>

                  <input
                    value={manualQuantity}
                    onChange={(e) => setManualQuantity(e.target.value)}
                    type="number"
                    min={1}
                    className="h-12 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>

                <button
                  onClick={addDraftManualItem}
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-zinc-50 font-bold text-zinc-800"
                >
                  Agregar producto
                </button>

                {manualItems.length > 0 && (
                  <div className="space-y-2 rounded-2xl border border-zinc-200 bg-zinc-50 p-3">
                    {manualItems.map((item) => (
                      <div
                        key={item.menuItem.id}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="font-semibold text-zinc-800">
                          {item.menuItem.name} x{item.quantity}
                        </span>

                        <button
                          onClick={() =>
                            setManualItems((prev) =>
                              prev.filter(
                                (current) =>
                                  current.menuItem.id !== item.menuItem.id
                              )
                            )
                          }
                          className="text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}

                    <div className="border-t border-zinc-200 pt-2 text-right font-black">
                      {formatPriceARS(manualTotal)}
                    </div>
                  </div>
                )}

                <button
                  onClick={createManualBill}
                  disabled={processing || !isOnline}
                  className="h-12 w-full rounded-2xl bg-zinc-950 font-black text-white disabled:opacity-50"
                >
                  Crear cuenta
                </button>
              </div>
            </section>
          </div>

          <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
            {!selectedCuenta ? (
              <div className="flex h-full min-h-[520px] flex-col items-center justify-center text-center">
                <Receipt size={52} className="mb-4 text-zinc-300" />
                <h2 className="text-2xl font-black text-zinc-950">
                  Seleccioná una cuenta
                </h2>
                <p className="mt-2 max-w-sm text-sm text-zinc-500">
                  Elegí una mesa para ver detalle, aplicar descuentos,
                  agregar productos o cobrar.
                </p>
              </div>
            ) : (
              <div className="space-y-8">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                      Cuenta activa
                    </p>
                    <h2 className="mt-1 text-5xl font-black tracking-tight text-zinc-950">
                      Mesa {selectedCuenta.mesa}
                    </h2>
                    <p className="mt-3 text-sm text-zinc-500">
                      Método elegido por cliente:{" "}
                      <span className="font-bold text-zinc-950">
                        {selectedPaymentLabel}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-zinc-500">
                      Estado:{" "}
                      <span className="font-bold capitalize text-zinc-950">
                        {selectedCuenta.estado}
                      </span>
                    </p>
                  </div>

                  <button
                     onClick={handlePrint}
                     disabled={!isOnline}
                    className="flex h-12 items-center disabled:opacity-50 gap-2 rounded-2xl border border-zinc-200 bg-white px-4 font-semibold text-zinc-700 transition hover:bg-zinc-50"
                  >
                    <Printer size={18} />
                    Imprimir pre-cuenta
                  </button>
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                  <h3 className="mb-3 text-lg font-black text-zinc-950">
                    Detalle consumido
                  </h3>

                  {selectedItems.length === 0 ? (
                    <p className="text-sm text-zinc-500">
                      No se encontraron productos asociados a esta cuenta.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {selectedItems.map((item, index) => {
                        const name = getItemName(item);
                        const quantity = getItemQuantity(item);
                        const price = getItemPrice(item);
                        const subtotal = getItemSubtotal(item);

                        return (
                          <div
                            key={`${name}-${index}`}
                            className="rounded-2xl border border-zinc-200 bg-white px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-black text-zinc-950">
                                  {name}
                                </p>
                                <p className="mt-1 text-xs font-semibold text-zinc-500">
                                  {quantity} x {formatPriceARS(price)}
                                </p>
                                {item.observacion && (
                                  <p className="mt-1 text-xs text-amber-700">
                                    Obs: {item.observacion}
                                  </p>
                                )}
                              </div>

                              <p className="font-black text-zinc-950">
                                {formatPriceARS(subtotal)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {selectedCuenta.sessionId &&
                  selectedCuenta.estado !== "pagada" &&
                  selectedCuenta.estado !== "cerrada" && (
                <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                  <h3 className="mb-3 text-lg font-black text-zinc-950">
                    Agregar producto a esta cuenta
                  </h3>

                  <div className="grid gap-2 sm:grid-cols-[1fr_100px_auto]">
                    <select
                      value={addSelectedMenuId}
                      onChange={(e) => setAddSelectedMenuId(e.target.value)}
                      className="h-12 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                    >
                      <option value="">Seleccionar producto</option>
                      {menuItems.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {formatPriceARS(item.price)}
                        </option>
                      ))}
                    </select>

                    <input
                      value={addQuantity}
                      onChange={(e) => setAddQuantity(e.target.value)}
                      type="number"
                      min={1}
                      className="h-12 rounded-2xl border border-zinc-200 px-3 outline-none focus:ring-2 focus:ring-black/10"
                    />

                    <button
                      onClick={addItemToSelectedBill}
                      disabled={processing || !isOnline}
                      className="h-12 rounded-2xl bg-zinc-950 px-5 font-black text-white disabled:opacity-50"
                    >
                      Agregar
                    </button>
                  </div>
                </div>
                )}

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                    <h3 className="mb-3 text-lg font-black text-zinc-950">
                      Descuento / ajuste
                    </h3>

                    <div className="space-y-3">
                      <select
                        value={discountType}
                        onChange={(e) =>
                          setDiscountType(e.target.value as CashierDiscountType)
                        }
                        className="h-12 w-full rounded-2xl border border-zinc-200 px-3"
                      >
                        <option value="none">Sin descuento</option>
                        <option value="fixed">Descuento fijo</option>
                        <option value="percentage">Descuento %</option>
                      </select>

                      <input
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        type="number"
                        min={0}
                        placeholder="Valor del descuento"
                        className="h-12 w-full rounded-2xl border border-zinc-200 px-4"
                      />

                      <input
                        value={discountReason}
                        onChange={(e) => setDiscountReason(e.target.value)}
                        placeholder="Motivo obligatorio si hay descuento"
                        className="h-12 w-full rounded-2xl border border-zinc-200 px-4"
                      />

                      <input
                        value={manualExtraAmount}
                        onChange={(e) => setManualExtraAmount(e.target.value)}
                        type="number"
                        min={0}
                        placeholder="Extra manual opcional"
                        className="h-12 w-full rounded-2xl border border-zinc-200 px-4"
                      />

                      <input
                        value={manualExtraReason}
                        onChange={(e) => setManualExtraReason(e.target.value)}
                        placeholder="Motivo del extra"
                        className="h-12 w-full rounded-2xl border border-zinc-200 px-4"
                      />

                      <button
                          onClick={saveAdjustments}
                          disabled={processing || !isOnline}
                        className="h-12 w-full rounded-2xl bg-zinc-950 font-black text-white disabled:opacity-50"
                      >
                        Guardar ajustes
                      </button>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-zinc-200 bg-zinc-50 p-4">
                    <h3 className="mb-3 text-lg font-black text-zinc-950">
                      Resumen
                    </h3>

                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span>Subtotal</span>
                        <strong>{formatPriceARS(realSubtotal)}</strong>
                      </div>

                      <div className="flex justify-between text-sm text-red-600">
                        <span>Descuento</span>
                        <strong>-{formatPriceARS(discountAmount)}</strong>
                      </div>

                      <div className="flex justify-between text-sm">
                        <span>Extra</span>
                        <strong>{formatPriceARS(extraAmount)}</strong>
                      </div>

                      <div className="flex justify-between text-sm">
                        <span>Pagado</span>
                        <strong>{formatPriceARS(paidTotal)}</strong>
                      </div>

                      <div className="border-t border-zinc-200 pt-4">
                        <p className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                          Total final
                        </p>
                        <p className="mt-1 text-5xl font-black text-zinc-950">
                          {formatPriceARS(finalTotal)}
                        </p>
                        <p className="mt-2 text-sm font-bold text-zinc-600">
                          Saldo pendiente: {formatPriceARS(remainingAmount)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                  <h3 className="mb-4 text-lg font-black text-zinc-950">
                    Registrar pago
                  </h3>

                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <select
                      value={paymentMethod}
                      onChange={(e) =>
                        setPaymentMethod(e.target.value as CashierPaymentMethod)
                      }
                      className="h-12 rounded-2xl border border-zinc-200 px-3"
                    >
                      <option value="cash">Efectivo</option>
                      <option value="debit">Débito</option>
                      <option value="credit">Crédito</option>
                      <option value="transfer">Transferencia</option>
                      <option value="mercado_pago">Mercado Pago</option>
                      <option value="mixed">Mixto</option>
                      <option value="other">Otro</option>
                    </select>

                    <input
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      type="number"
                      min={remainingAmount}
                      placeholder="Monto"
                      className={`h-12 rounded-2xl border px-4 ${
                        isPaymentAmountInvalid
                          ? "border-red-300 bg-red-50"
                          : "border-zinc-200"
                      }`}
                    />

                    <button
                      onClick={handleMarkPaid}
                      disabled={
                        processing ||
                        !isOnline ||
                        selectedCuenta.estado === "pagada" ||
                        isPaymentAmountInvalid
                      }
                      className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 font-black text-white disabled:opacity-50"
                    >
                      <Wallet size={18} />
                      Cobrar
                    </button>
                  </div>

                  {isPaymentAmountInvalid && selectedCuenta.estado !== "pagada" && (
                    <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                      El monto a cobrar debe ser igual o mayor al saldo pendiente:{" "}
                      {formatPriceARS(remainingAmount)}.
                    </p>
                  )}

                  {selectedCuenta.payments &&
                    selectedCuenta.payments.length > 0 && (
                      <div className="mt-4 space-y-2">
                        {selectedCuenta.payments.map((payment) => (
                          <div
                            key={payment.id}
                            className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                          >
                            <span className="font-semibold">
                              {paymentLabels[payment.method] || payment.method}
                            </span>
                            <strong>{formatPriceARS(payment.amount)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                </div>

                <div className="rounded-3xl border border-zinc-200 bg-white p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <FileText size={18} />
                    <h3 className="text-lg font-black text-zinc-950">
                      Solicitud de factura
                    </h3>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <select
                      value={invoiceType}
                      onChange={(e) =>
                        setInvoiceType(
                          e.target.value as "A" | "B" | "C" | "ticket"
                        )
                      }
                      className="h-12 rounded-2xl border border-zinc-200 px-3"
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
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <select
                      value={invoiceDocumentType}
                      onChange={(e) =>
                        setInvoiceDocumentType(
                          e.target.value as
                            | "DNI"
                            | "CUIT"
                            | "CUIL"
                            | "PASSPORT"
                        )
                      }
                      className="h-12 rounded-2xl border border-zinc-200 px-3"
                    >
                      <option value="DNI">DNI</option>
                      <option value="CUIT">CUIT</option>
                      <option value="CUIL">CUIL</option>
                      <option value="PASSPORT">Pasaporte</option>
                    </select>

                    <input
                      value={invoiceDocumentNumber}
                      onChange={(e) => setInvoiceDocumentNumber(e.target.value)}
                      placeholder="Número de documento"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceIvaCondition}
                      onChange={(e) => setInvoiceIvaCondition(e.target.value)}
                      placeholder="Condición IVA"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceFiscalRegime}
                      onChange={(e) => setInvoiceFiscalRegime(e.target.value)}
                      placeholder="Régimen fiscal"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceFiscalAddress}
                      onChange={(e) => setInvoiceFiscalAddress(e.target.value)}
                      placeholder="Dirección fiscal"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoicePostalCode}
                      onChange={(e) => setInvoicePostalCode(e.target.value)}
                      placeholder="Código postal"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceProvince}
                      onChange={(e) => setInvoiceProvince(e.target.value)}
                      placeholder="Provincia"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceCity}
                      onChange={(e) => setInvoiceCity(e.target.value)}
                      placeholder="Localidad"
                      className="h-12 rounded-2xl border border-zinc-200 px-4"
                    />

                    <input
                      value={invoiceEmail}
                      onChange={(e) => setInvoiceEmail(e.target.value)}
                      placeholder="Email para enviar factura"
                      className="h-12 rounded-2xl border border-zinc-200 px-4 md:col-span-2"
                    />
                  </div>

                  <button
                      onClick={handleRequestInvoice}
                      disabled={processing || !isOnline}
                    className="mt-3 h-12 w-full rounded-2xl border border-zinc-200 bg-zinc-50 font-black text-zinc-800 disabled:opacity-50"
                  >
                    Guardar solicitud de factura
                  </button>

                  {selectedCuenta.invoice?.status && (
                    <p className="mt-3 text-sm font-semibold text-zinc-500">
                      Estado factura: {selectedCuenta.invoice.status}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>

    {/* Opening cash dialog */}
    {showOpeningDialog && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
          <h2 className="text-2xl font-black text-zinc-950">Apertura de caja</h2>
          <p className="mt-2 text-sm text-zinc-500">
            Ingresá el monto inicial en efectivo que tenés en la caja.
          </p>
          <input
            value={openingCashInput}
            onChange={(e) => setOpeningCashInput(e.target.value)}
            type="number"
            min={0}
            placeholder="$0"
            className="mt-4 h-14 w-full rounded-2xl border border-zinc-200 px-4 text-xl font-black outline-none focus:ring-2 focus:ring-black/10"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && confirmOpeningCash()}
          />
          <button
            onClick={() => confirmOpeningCash()}
            className="mt-3 h-12 w-full rounded-2xl bg-zinc-950 font-black text-white transition hover:bg-zinc-800"
          >
            Abrir caja
          </button>
          <button
            onClick={() => confirmOpeningCash(0)}
            className="mt-2 w-full rounded-xl py-2 text-sm font-bold text-zinc-400 transition hover:text-zinc-600"
          >
            Continuar sin ingresar monto
          </button>
        </div>
      </div>
    )}

    {/* Cierre de caja modal */}
    {showCierreModal && (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
          <div className="sticky top-0 flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
            <div>
              <h2 className="text-xl font-black text-zinc-950">Cierre de caja</h2>
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
            <button
              onClick={() => setShowCierreModal(false)}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
            >
              <X size={18} />
            </button>
          </div>

          <div className="space-y-6 p-6">
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">
                  Monto inicial
                </p>
                <p className="mt-1 text-2xl font-black text-zinc-950">
                  {formatPriceARS(cashSession?.openingCash ?? 0)}
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                  Efectivo en caja
                </p>
                <p className="mt-1 text-2xl font-black text-emerald-900">
                  {formatPriceARS(totalCajaActual)}
                </p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-blue-700">
                  Total recaudado
                </p>
                <p className="mt-1 text-2xl font-black text-blue-900">
                  {formatPriceARS(totalRecaudado)}
                </p>
              </div>
            </div>

            {/* Breakdown by payment method */}
            <div>
              <h3 className="mb-3 text-base font-black text-zinc-950">
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
                        className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-zinc-950">
                            {paymentLabels[method] || method}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-bold text-zinc-600">
                            {data.count} cuenta{data.count !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <span className="text-base font-black text-zinc-950">
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
                <h3 className="mb-3 text-base font-black text-zinc-950">
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
                        className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-black text-zinc-950">
                            Mesa {cuenta.mesa}
                          </span>
                          <span className="rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs font-bold text-zinc-600">
                            {paymentLabels[method] || method}
                          </span>
                        </div>
                        <span className="text-sm font-black text-zinc-950">
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
              <h3 className="mb-3 text-base font-black text-zinc-950">
                Ajustes de caja
              </h3>

              {!adjustForm ? (
                <div className="flex gap-2">
                  <button
                    onClick={() =>
                      setAdjustForm({ type: "add", amount: "", reason: "" })
                    }
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 text-sm font-black text-emerald-700 transition hover:bg-emerald-100"
                  >
                    + Agregar monto
                  </button>
                  <button
                    onClick={() =>
                      setAdjustForm({ type: "deduct", amount: "", reason: "" })
                    }
                    className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-red-200 bg-red-50 text-sm font-black text-red-700 transition hover:bg-red-100"
                  >
                    − Descontar monto
                  </button>
                </div>
              ) : (
                <div
                  className={`rounded-2xl border p-4 ${
                    adjustForm.type === "add"
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-red-200 bg-red-50"
                  }`}
                >
                  <p className="mb-3 text-sm font-black text-zinc-950">
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
                      onKeyDown={(e) => e.key === "Enter" && saveAdjustment()}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={saveAdjustment}
                        disabled={
                          !adjustForm.amount ||
                          Number(adjustForm.amount) <= 0 ||
                          !adjustForm.reason.trim()
                        }
                        className={`h-10 flex-1 rounded-xl font-black text-sm text-white transition disabled:opacity-40 ${
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
                      className={`flex items-center justify-between rounded-2xl border px-4 py-3 ${
                        adj.type === "add"
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-red-200 bg-red-50"
                      }`}
                    >
                      <div>
                        <span
                          className={`text-sm font-black ${
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
            {/* Close register */}
            <div className="border-t border-zinc-200 pt-4">
              <button
                onClick={handleCierreCaja}
                disabled={closingCaja}
                className="h-13 w-full rounded-2xl bg-zinc-950 font-black text-white transition hover:bg-zinc-800 disabled:opacity-50 py-3"
              >
                {closingCaja ? "Registrando cierre..." : "Cerrar caja y registrar auditoría"}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Cashier;