import { CreditCard, MessageCircleWarning } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

const WHATSAPP_NUMBER = "+543546403338";

const PaymentRequired = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const restaurantId = searchParams.get("restaurantId") || "mi-restaurante";

  const handleRetryAccess = () => {
    navigate(`/staff/admin?restaurantId=${restaurantId}`, { replace: true });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f4ef] px-4">
      <div className="w-full max-w-md rounded-[32px] border border-black/5 bg-white p-8 shadow-[0_18px_50px_-18px_rgba(0,0,0,0.22)]">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#6B4423]/10">
            <CreditCard size={38} className="text-[#6B4423]" />
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs font-extrabold uppercase tracking-[0.28em] text-zinc-500">
            WANT RESTAURANT SAAS
          </p>

          <h1 className="mt-3 text-3xl font-black tracking-tight text-zinc-950">
            Suscripción vencida
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-zinc-600">
            Tu restaurante fue suspendido temporalmente porque la suscripción
            mensual está vencida o el período de prueba finalizó.
          </p>
        </div>

        <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <MessageCircleWarning
              size={20}
              className="mt-0.5 text-amber-600"
            />

            <div>
              <p className="text-sm font-bold text-amber-900">
                Acceso temporalmente restringido
              </p>

              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                Para volver a habilitar el panel administrativo y el menú
                digital, contactate con el soporte de WANT.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-7 space-y-3">
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}?text=Hola,%20quiero%20reactivar%20mi%20suscripci%C3%B3n%20de%20WANT.%20Restaurante:%20${restaurantId}`}
            target="_blank"
            rel="noreferrer"
            className="flex h-14 w-full items-center justify-center rounded-2xl bg-[#6B4423] text-sm font-extrabold text-white transition-all hover:scale-[1.01] active:scale-[0.99]"
          >
            Contactar soporte
          </a>

          <button
            type="button"
            onClick={handleRetryAccess}
            className="h-12 w-full rounded-2xl border border-black/10 bg-white text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
          >
            Reintentar acceso
          </button>
        </div>

        <div className="mt-6 text-center">
          <p className="text-xs text-zinc-400">
            WANT © Plataforma SaaS para restaurantes
          </p>
        </div>
      </div>
    </div>
  );
};

export default PaymentRequired;