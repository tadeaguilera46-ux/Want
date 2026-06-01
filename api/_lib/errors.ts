/**
 * Error explícitamente generado por la lógica de negocio — su mensaje
 * es seguro para mostrar al usuario final.
 * Cualquier otro error (Firebase, red, runtime) usa un mensaje genérico.
 */
export class UserFacingError extends Error {
  readonly userFacing = true as const;

  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

/**
 * Extrae el mensaje a devolver en la respuesta HTTP.
 * Solo expone el mensaje si el error fue lanzado explícitamente como UserFacingError.
 */
export const toApiErrorMessage = (error: unknown): string => {
  if (error instanceof UserFacingError) {
    return error.message;
  }
  return "No se pudo procesar el pedido. Reintentá.";
};
