/** Error con un mensaje que se le puede mostrar a la persona tal cual. */
export class UserError extends Error {
  fields?: Record<string, string>;
  constructor(message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "UserError";
    this.fields = fields;
  }
}

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string; fields?: Record<string, string> };

/** Envuelve una acción: los UserError se devuelven como mensaje; los demás se registran y se muestran genéricos. */
export async function safely<T>(fn: () => Promise<T>, success?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: success };
  } catch (error) {
    if (error instanceof UserError) return { ok: false, error: error.message, fields: error.fields };
    if (isRedirect(error)) throw error;
    console.error(error);
    return { ok: false, error: "Algo salió mal. Intenta de nuevo en un momento." };
  }
}

function isRedirect(error: unknown) {
  return typeof error === "object" && error !== null && "digest" in error && String((error as { digest: unknown }).digest).startsWith("NEXT_");
}
