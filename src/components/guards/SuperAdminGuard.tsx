import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";

type Props = { children: ReactNode };

const SuperAdminGuard = ({ children }: Props) => {
  const { user, loading } = useAuth();
  const [claimChecked, setClaimChecked] = useState(false);
  const [hasClaim, setHasClaim] = useState(false);

  useEffect(() => {
    if (loading) return;

    if (!user) {
      // Not logged in — SuperAdmin handles its own login form.
      setHasClaim(false);
      setClaimChecked(true);
      return;
    }

    user
      .getIdTokenResult(true)
      .then((result) => {
        setHasClaim(result.claims["superAdmin"] === true);
        setClaimChecked(true);
      })
      .catch(() => {
        setHasClaim(false);
        setClaimChecked(true);
      });
  }, [user, loading]);

  if (loading || !claimChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm font-semibold text-muted-foreground">
          Verificando acceso...
        </p>
      </div>
    );
  }

  // Authenticated but without the superAdmin claim → block.
  if (user && !hasClaim) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="rounded-xl border border-red-800/50 bg-card p-6 text-center shadow-sm">
          <p className="text-lg font-bold text-foreground">Acceso denegado</p>
          <p className="mt-2 text-sm text-muted-foreground">
            No tenés permisos para acceder a esta sección.
          </p>
        </div>
      </div>
    );
  }

  // user === null → SuperAdmin shows its own login form.
  // user with claim → render content.
  return <>{children}</>;
};

export default SuperAdminGuard;
