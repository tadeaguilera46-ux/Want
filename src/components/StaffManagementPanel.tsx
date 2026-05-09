import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
} from "firebase/firestore";
import { UserCog } from "lucide-react";
import { getDb } from "../lib/firebase";
import type { StaffRole } from "../lib/staff";
import {
  canCreateStaff,
  getPlanLimits,
  getStaffLimitLabel,
  normalizePlan,
  PLAN_LABELS,
  type RestaurantPlan,
} from "../lib/plan";

type StaffMember = {
  id: string;
  uid?: string;
  email?: string;
  role?: StaffRole;
  active?: boolean;
  createdAt?: {
    seconds?: number;
    toMillis?: () => number;
  };
};

type RestaurantBillingData = {
  plan?: RestaurantPlan;
};

type Props = {
  restaurantId: string;
};

const db = getDb();

const roleLabel: Record<StaffRole, string> = {
  admin: "Admin",
  kitchen: "Cocina",
  bar: "Barra",
  runner: "Runner",
  cashier: "Cajero",
};

const getCreatedAtMillis = (member: StaffMember) => {
  if (typeof member.createdAt?.toMillis === "function") {
    return member.createdAt.toMillis();
  }

  if (typeof member.createdAt?.seconds === "number") {
    return member.createdAt.seconds * 1000;
  }

  return 0;
};

export function StaffManagementPanel({ restaurantId }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [restaurantPlan, setRestaurantPlan] =
    useState<RestaurantPlan>("starter");
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!restaurantId) return;

    const unsubscribe = onSnapshot(
      doc(db, "restaurants", restaurantId),
      (snapshot) => {
        const data = snapshot.data() as RestaurantBillingData | undefined;
        setRestaurantPlan(normalizePlan(data?.plan));
      },
      (error) => {
        console.error("Error cargando plan del restaurante:", error);
        setRestaurantPlan("starter");
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  useEffect(() => {
    if (!restaurantId) return;

    setLoading(true);

    const q = query(collection(db, "restaurants", restaurantId, "staff"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const data = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        })) as StaffMember[];

        setStaff(data);
        setLoading(false);
      },
      (error) => {
        console.error("Error cargando empleados:", error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [restaurantId]);

  const sortedStaff = useMemo(() => {
    return [...staff].sort((a, b) => {
      const bTime = getCreatedAtMillis(b);
      const aTime = getCreatedAtMillis(a);

      if (bTime !== aTime) return bTime - aTime;

      return (a.email || "").localeCompare(b.email || "");
    });
  }, [staff]);

  const activeStaffCount = useMemo(() => {
    return staff.filter((member) => member.active === true).length;
  }, [staff]);

  const activeAdminsCount = useMemo(() => {
    return staff.filter(
      (member) => member.role === "admin" && member.active === true
    ).length;
  }, [staff]);

  const staffLimitLabel = getStaffLimitLabel(restaurantPlan);
  const planLimits = getPlanLimits(restaurantPlan);
  const reachedStaffLimit = !canCreateStaff(restaurantPlan, activeStaffCount);

  const isLastActiveAdmin = (member: StaffMember) => {
    return (
      member.role === "admin" &&
      member.active === true &&
      activeAdminsCount <= 1
    );
  };

  const updateStaffRole = async (member: StaffMember, role: StaffRole) => {
    if (isLastActiveAdmin(member) && role !== "admin") {
      alert("No podés quitarle el rol admin al último admin activo.");
      return;
    }

    try {
      setUpdatingId(member.id);

      await updateDoc(doc(db, "restaurants", restaurantId, "staff", member.id), {
        role,
      });
    } catch (error) {
      console.error("Error actualizando rol:", error);
      alert("No se pudo actualizar el rol");
    } finally {
      setUpdatingId(null);
    }
  };

  const updateStaffEmail = async (staffId: string, email: string) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail) {
      alert("El email no puede quedar vacío");
      return;
    }

    try {
      setUpdatingId(staffId);

      await updateDoc(doc(db, "restaurants", restaurantId, "staff", staffId), {
        email: normalizedEmail,
      });
    } catch (error) {
      console.error("Error actualizando email:", error);
      alert("No se pudo actualizar el email");
    } finally {
      setUpdatingId(null);
    }
  };

  const toggleStaffActive = async (member: StaffMember) => {
    const nextActive = member.active !== true;

    if (isLastActiveAdmin(member)) {
      alert("No podés desactivar al último admin activo.");
      return;
    }

    if (nextActive && !canCreateStaff(restaurantPlan, activeStaffCount)) {
      alert(
        `Tu plan ${PLAN_LABELS[restaurantPlan]} permite hasta ${staffLimitLabel} empleados activos.`
      );
      return;
    }

    try {
      setUpdatingId(member.id);

      await updateDoc(doc(db, "restaurants", restaurantId, "staff", member.id), {
        active: nextActive,
      });
    } catch (error) {
      console.error("Error actualizando empleado:", error);
      alert("No se pudo actualizar el empleado");
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <section className="mb-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zinc-950 text-white">
            <UserCog size={20} />
          </div>

          <div>
            <h2 className="text-xl font-black text-zinc-950">
              Gestión de empleados
            </h2>
            <p className="mt-1 text-sm text-zinc-500">
              Cambiá emails visibles, roles o accesos sin borrar usuarios.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-zinc-700">
                Plan {PLAN_LABELS[restaurantPlan]}
              </span>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                  reachedStaffLimit
                    ? "border-red-200 bg-red-100 text-red-700"
                    : "border-emerald-200 bg-emerald-100 text-emerald-700"
                }`}
              >
                Empleados activos: {activeStaffCount} / {staffLimitLabel}
              </span>

              {planLimits.maxStaff !== null && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                  Upgrade a Premium para empleados ilimitados
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-bold text-zinc-600">
          {sortedStaff.length} empleado(s)
        </div>
      </div>

      {reachedStaffLimit && (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          Alcanzaste el límite de empleados activos para el plan{" "}
          {PLAN_LABELS[restaurantPlan]}. Desactivá un empleado o subí de plan.
        </div>
      )}

      {loading ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          Cargando empleados...
        </div>
      ) : sortedStaff.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
          Todavía no hay empleados creados.
        </div>
      ) : (
        <div className="max-h-[430px] overflow-y-auto rounded-2xl border border-zinc-200">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50">
              <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <th className="py-3 pl-4 pr-4">Empleado</th>
                <th className="py-3 pr-4">UID</th>
                <th className="py-3 pr-4">Rol</th>
                <th className="py-3 pr-4">Estado</th>
                <th className="py-3 pr-4">Tipo</th>
                <th className="py-3 pr-4 text-right">Acción</th>
              </tr>
            </thead>

            <tbody>
              {sortedStaff.map((member) => {
                const isUpdating = updatingId === member.id;
                const active = member.active === true;
                const isOld = getCreatedAtMillis(member) === 0;
                const lockedAdmin = isLastActiveAdmin(member);
                const cannotActivateBecauseLimit =
                  !active && reachedStaffLimit;

                return (
                  <tr
                    key={member.id}
                    className="border-b border-zinc-100 last:border-0"
                  >
                    <td className="py-4 pl-4 pr-4">
                      <input
                        defaultValue={member.email || ""}
                        placeholder="Sin email guardado"
                        disabled={isUpdating}
                        onBlur={(e) => {
                          const nextEmail = e.target.value;
                          const currentEmail = member.email || "";

                          if (nextEmail.trim() !== currentEmail.trim()) {
                            void updateStaffEmail(member.id, nextEmail);
                          }
                        }}
                        className="h-10 w-full min-w-[220px] rounded-2xl border border-zinc-200 bg-white px-3 font-semibold text-zinc-950 outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                      />

                      <p className="mt-1 text-xs text-zinc-500">
                        Documento: {member.id}
                      </p>

                      {lockedAdmin && (
                        <p className="mt-1 text-xs font-semibold text-red-600">
                          Último admin activo
                        </p>
                      )}

                      {cannotActivateBecauseLimit && (
                        <p className="mt-1 text-xs font-semibold text-amber-700">
                          Límite del plan alcanzado
                        </p>
                      )}
                    </td>

                    <td className="py-4 pr-4">
                      <span className="font-mono text-xs text-zinc-500">
                        {member.uid || member.id}
                      </span>
                    </td>

                    <td className="py-4 pr-4">
                      <select
                        value={member.role || "runner"}
                        disabled={isUpdating}
                        onChange={(e) =>
                          void updateStaffRole(
                            member,
                            e.target.value as StaffRole
                          )
                        }
                        className="h-10 rounded-2xl border border-zinc-200 bg-white px-3 outline-none focus:ring-2 focus:ring-black/10 disabled:opacity-60"
                      >
                        <option value="runner">{roleLabel.runner}</option>
                        <option value="kitchen">{roleLabel.kitchen}</option>
                        <option value="bar">{roleLabel.bar}</option>
                        <option value="admin">{roleLabel.admin}</option>
                        <option value="cashier">{roleLabel.cashier}</option>
                      </select>
                    </td>

                    <td className="py-4 pr-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          active
                            ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                            : "bg-red-100 text-red-700 border border-red-200"
                        }`}
                      >
                        {active ? "Activo" : "Inactivo"}
                      </span>
                    </td>

                    <td className="py-4 pr-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                          isOld
                            ? "bg-zinc-100 text-zinc-600 border border-zinc-200"
                            : "bg-blue-100 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {isOld ? "Viejo" : "Nuevo"}
                      </span>
                    </td>

                    <td className="py-4 pr-4 text-right">
                      <button
                        onClick={() => void toggleStaffActive(member)}
                        disabled={isUpdating || lockedAdmin}
                        className={`h-10 rounded-2xl px-4 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                          active
                            ? "bg-red-600 text-white hover:opacity-90"
                            : "bg-emerald-600 text-white hover:opacity-90"
                        }`}
                      >
                        {isUpdating
                          ? "Guardando..."
                          : active
                            ? "Desactivar"
                            : "Activar"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}