import { useEffect, useState } from "react";
import { getApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  Users,
  XCircle,
} from "lucide-react";

type CancellationDetails = {
  restaurantName: string;
  name: string;
  date: string;
  time: string;
  partySize: number;
  status: string;
  canCancel: boolean;
};

const functions = getFunctions(getApp(), "us-central1");

const errorMessage = (error: unknown) => {
  const value =
    error && typeof error === "object"
      ? (error as { code?: unknown; details?: unknown; message?: unknown })
      : {};
  const code =
    typeof value.code === "string"
      ? value.code.replace(/^functions\//, "")
      : "";
  const details = typeof value.details === "string" ? value.details.trim() : "";
  const message =
    typeof value.message === "string" ? value.message.trim() : "";

  if (details) return details;
  if (
    message &&
    !["internal", "unknown", "FirebaseError: internal"].includes(message)
  ) {
    return message.replace(/^Firebase:\s*/i, "");
  }
  if (code === "permission-denied") return "El enlace de cancelación no es válido.";
  if (code === "failed-precondition") return "Esta reserva ya no puede cancelarse.";
  if (code === "unavailable") return "No pudimos conectar con Reservas. Reintentá.";
  if (code === "internal") return "Reservas no pudo procesar el enlace. Reintentá.";
  return "No pudimos validar el enlace de cancelación.";
};

const ReservationCancellation = () => {
  const [searchParams] = useSearchParams();
  const restaurantId = searchParams.get("restaurantId") || "";
  const reservationId = searchParams.get("reservationId") || "";
  const token = searchParams.get("token") || "";
  const [details, setDetails] = useState<CancellationDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadReservation = async () => {
      if (!restaurantId || !reservationId || !token) {
        setError("El enlace de cancelación está incompleto.");
        setLoading(false);
        return;
      }

      try {
        const getReservation = httpsCallable<
          { restaurantId: string; reservationId: string; token: string },
          CancellationDetails
        >(functions, "getReservationForCancellation");
        const result = await getReservation({
          restaurantId,
          reservationId,
          token,
        });
        if (active) setDetails(result.data);
      } catch (loadError) {
        if (active) setError(errorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadReservation();
    return () => {
      active = false;
    };
  }, [restaurantId, reservationId, token]);

  const cancelReservation = async () => {
    try {
      setCancelling(true);
      setError(null);
      const cancel = httpsCallable<
        { restaurantId: string; reservationId: string; token: string },
        { ok: boolean; alreadyCancelled: boolean }
      >(functions, "cancelReservationByCustomer");
      await cancel({ restaurantId, reservationId, token });
      setDetails((current) =>
        current ? { ...current, status: "cancelled", canCancel: false } : current
      );
    } catch (cancelError) {
      setError(errorMessage(cancelError));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-10">
      <main className="mx-auto w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.25em] text-zinc-400">
          WANT Reservas
        </p>

        {loading ? (
          <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-zinc-500">
            <Loader2 className="animate-spin" size={30} />
            <p className="text-sm font-semibold">Validando reserva...</p>
          </div>
        ) : error && !details ? (
          <div className="py-12 text-center">
            <AlertTriangle className="mx-auto text-amber-500" size={38} />
            <h1 className="mt-4 text-xl font-black text-zinc-950">
              No pudimos abrir la reserva
            </h1>
            <p className="mt-2 text-sm text-zinc-500">{error}</p>
          </div>
        ) : details?.status === "cancelled" ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="mx-auto text-emerald-600" size={42} />
            <h1 className="mt-4 text-2xl font-black text-zinc-950">
              Reserva cancelada
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              Tu lugar en {details.restaurantName} fue liberado correctamente.
            </p>
          </div>
        ) : details ? (
          <>
            <div className="mt-6">
              <h1 className="text-2xl font-black text-zinc-950">
                Cancelar reserva
              </h1>
              <p className="mt-1 text-sm text-zinc-500">
                Revisá los datos antes de confirmar la cancelación.
              </p>
            </div>

            <div className="mt-6 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <p className="font-black text-zinc-950">{details.restaurantName}</p>
              <p className="mt-1 text-sm font-semibold text-zinc-600">
                Reserva de {details.name}
              </p>
              <div className="mt-4 grid gap-3 text-sm text-zinc-600 sm:grid-cols-3">
                <span className="flex items-center gap-2">
                  <CalendarDays size={16} /> {details.date}
                </span>
                <span className="flex items-center gap-2">
                  <Clock3 size={16} /> {details.time}
                </span>
                <span className="flex items-center gap-2">
                  <Users size={16} /> {details.partySize} personas
                </span>
              </div>
            </div>

            {error && (
              <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {error}
              </p>
            )}

            {details.canCancel ? (
              <button
                type="button"
                onClick={cancelReservation}
                disabled={cancelling}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-600 font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {cancelling ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <XCircle size={18} />
                )}
                {cancelling ? "Cancelando..." : "Confirmar cancelación"}
              </button>
            ) : (
              <p className="mt-6 rounded-lg bg-amber-50 px-3 py-3 text-sm font-semibold text-amber-700">
                Esta reserva ya no admite cancelación desde el enlace.
              </p>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
};

export default ReservationCancellation;
