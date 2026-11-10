import { describe, expect, it, vi } from "vitest";
import { safely, UserError } from "../lib/server/errors";

describe("resultado de una acción", () => {
  it("un error para la persona dice con certeza que no quedó nada; uno inesperado va marcado", async () => {
    // UserError: la regla lo rechazó dentro de la transacción y no quedó nada
    expect(await safely(async () => Promise.reject(new UserError("Solo falta pagar $0")))).toEqual({ ok: false, error: "Solo falta pagar $0", fields: undefined });
    expect(await safely(async () => Promise.reject(new UserError("Confírmala", { tipConfirm: "1" })))).toEqual({ ok: false, error: "Confírmala", fields: { tipConfirm: "1" } });
    // Cualquier otro error (se cayó la conexión con la base al confirmar) no dice si quedó: el cobro lo trata como «no se supo»
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const r = await safely(async () => Promise.reject(new Error("Connection terminated unexpectedly")));
      expect(r).toEqual({ ok: false, error: "Algo salió mal. Intenta de nuevo en un momento.", fields: { unexpected: "1" } });
    } finally {
      log.mockRestore();
    }
    expect(await safely(async () => 7, "Listo")).toEqual({ ok: true, data: 7, message: "Listo" });
  });

  it("una redirección de Next no se convierte en error: sigue su camino", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/entrar?sesion=1;307;" });
    await expect(safely(async () => Promise.reject(redirect))).rejects.toBe(redirect);
  });
});
