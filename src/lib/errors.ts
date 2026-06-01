/**
 * Error explícitamente generado por la lógica de negocio — su mensaje
 * es seguro para mostrar al usuario final.
 * Cualquier otro error (Firebase SDK, red, runtime) usa el fallback genérico.
 */
export class UserFacingError extends Error {
  readonly userFacing = true as const;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Devuelve un mensaje seguro para mostrar en la UI.
 *
 * - UserFacingError → pasa el mensaje tal cual (fue generado intencionalmente)
 * - En desarrollo → muestra el error real para facilitar el debugging
 * - En producción → devuelve el fallback genérico para cualquier otro error
 */
export const getDisplayMessage = (
  error: unknown,
  fallback = "Ocurrió un error inesperado. Recargá la pantalla e intentá de nuevo."
): string => {
  if (error instanceof UserFacingError) {
    return error.message;
  }
  if (import.meta.env.DEV && error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};
