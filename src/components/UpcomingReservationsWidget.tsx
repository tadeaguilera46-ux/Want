import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Users,
} from "lucide-react";
import { getDb } from "../lib/firebase";

type UpcomingReservation = {
  id: string;
  name: string;
  date: string;
  time: string;
  partySize: number;
  mesa?: number | null;
  status: "pending" | "confirmed" | string;
};

const db = getDb();
const MAX_VISIBLE_RESERVATIONS = 6;

const dateInBuenosAires = (offsetDays = 0) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const reservationTimeMs = (reservation: UpcomingReservation) => {
  const value = Date.parse(`${reservation.date}T${reservation.time}:00-03:00`);
  return Number.isFinite(value) ? value : 0;
};

const relativeTimeLabel = (milliseconds: number) => {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `en ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0
      ? `en ${hours} h ${remainingMinutes} min`
      : `en ${hours} h`;
  }
  return `en ${Math.floor(hours / 24)} día${hours >= 48 ? "s" : ""}`;
};

export function UpcomingReservationsWidget({
  restaurantId,
}: {
  restaurantId: string;
}) {
  const [reservations, setReservations] = useState<UpcomingReservation[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState(false);
  const currentDate = useMemo(() => dateInBuenosAires(), [now]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const candidateDates = [currentDate, dateInBuenosAires(1)];
    const reservationsQuery = query(
      collection(db, "restaurants", restaurantId, "reservations"),
      where("date", "in", candidateDates)
    );

    return onSnapshot(
      reservationsQuery,
      (snapshot) => {
        setError(false);
        setReservations(
          snapshot.docs.map(
            (reservationDoc) =>
              ({
                id: reservationDoc.id,
                ...reservationDoc.data(),
              }) as UpcomingReservation
          )
        );
      },
      () => {
        setError(true);
        setReservations([]);
      }
    );
  }, [currentDate, restaurantId]);

  const upcoming = useMemo(
    () =>
      reservations
        .filter(
          (reservation) =>
            (reservation.status === "pending" ||
              reservation.status === "confirmed") &&
            reservationTimeMs(reservation) >= now
        )
        .sort(
          (left, right) => reservationTimeMs(left) - reservationTimeMs(right)
        )
        .slice(0, MAX_VISIBLE_RESERVATIONS),
    [now, reservations]
  );

  if (error || upcoming.length === 0) return null;

  return (
    <aside className="fixed bottom-4 right-4 z-50 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
      <button
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        aria-expanded={expanded}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
          <CalendarClock size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold uppercase tracking-wide text-zinc-500">
            Próximas reservas
          </span>
          <span className="block truncate text-sm font-black text-zinc-950">
            {upcoming[0].time} · {upcoming[0].name} · {upcoming[0].partySize}p
          </span>
        </span>
        <span className="rounded-full bg-zinc-950 px-2 py-1 text-xs font-black text-white">
          {upcoming.length}
        </span>
        {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>

      {expanded && (
        <div className="max-h-[55vh] space-y-2 overflow-y-auto border-t border-zinc-100 bg-zinc-50 p-3">
          {upcoming.map((reservation) => (
            <div
              key={reservation.id}
              className="rounded-xl border border-zinc-200 bg-white p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-zinc-950">
                    {reservation.name}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs font-semibold text-zinc-500">
                    <span className="flex items-center gap-1">
                      <Clock3 size={12} />
                      {reservation.date === currentDate ? "Hoy" : "Mañana"}{" "}
                      {reservation.time}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      {reservation.partySize}p
                    </span>
                    {reservation.mesa && <span>Mesa {reservation.mesa}</span>}
                  </div>
                </div>
                <span className="shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                  {relativeTimeLabel(reservationTimeMs(reservation) - now)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
