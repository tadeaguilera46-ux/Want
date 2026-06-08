import { ArrowLeft, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { WaitlistPanel } from "../components/WaitlistPanel";
import { useRestaurant } from "../lib/restaurant-context";

export default function Waitlist() {
  const navigate = useNavigate();
  const { restaurantId } = useRestaurant();

  if (!restaurantId) return null;

  return (
    <div className="min-h-screen bg-zinc-100 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
            aria-label="Volver"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <Users size={18} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-950">Lista de espera</h1>
            <p className="text-sm text-zinc-500">
              Avisos, asignación de mesa y cierre de entradas.
            </p>
          </div>
        </header>

        <WaitlistPanel restaurantId={restaurantId} />
      </div>
    </div>
  );
}
