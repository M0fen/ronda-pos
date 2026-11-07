import "server-only";
import { deliveryStage, packingList, type DeliveryStage } from "../core/delivery";
import { minutesSince } from "../core/time";
import { normalizePhone } from "../utils";
import { can, type Staff } from "./auth";
import { audit, bump, getBusiness, nextNumber } from "./business";
import { checkLabel, loadCheck, type Delivery, type Mod } from "./checks";
import { getDb } from "./db";
import { UserError } from "./errors";
import { closeCheck, currentCashSession } from "./payments";

export interface DeliveryCard {
  id: string;
  number: number;
  label: string;
  channel: string;
  code: string;
  customer: string;
  phone: string;
  address: string;
  notes: string;
  stage: DeliveryStage;
  minutes: number;
  /** Minutos para que llegue el domiciliario (negativo: ya está esperando) */
  riderIn: number | null;
  items: { name: string; qty: number; modifiers: Mod[]; status: string; note: string }[];
  total: number;
  ready: number;
  count: number;
  checklist: string[];
  packedBy: string | null;
}

/** Tablero de domicilios: pedidos de Rappi, DiDi y propios, de que entran a que salen. */
export async function deliveryBoard(bizId: string, now = new Date()): Promise<DeliveryCard[]> {
  const db = await getDb();
  const checks = await db.query<{ id: string; number: number; name: string; channel: string; delivery: Delivery | null; opened_at: string }>(
    "select id, number, name, channel, delivery, opened_at from checks where business_id = $1 and kind = 'domicilio' and status in ('open','bill') order by opened_at",
    [bizId],
  );
  if (!checks.length) return [];
  const items = await db.query<{ check_id: string; name: string; qty: number; modifiers: Mod[]; status: string; note: string; unit_price: number }>(
    "select check_id, name, qty, modifiers, status, note, unit_price from check_items where check_id = any($1::uuid[]) order by created_at",
    [checks.map((c) => c.id)],
  );
  return checks.map((c) => {
    const mine = items.filter((i) => i.check_id === c.id);
    const live = mine.filter((i) => i.status !== "void");
    const d = c.delivery ?? { code: "" };
    return {
      id: c.id,
      number: c.number,
      label: checkLabel({ kind: "domicilio", table_name: null, name: c.name, number: c.number, channel: c.channel, delivery: d }),
      channel: c.channel,
      code: d.code,
      customer: c.name,
      phone: d.phone ?? "",
      address: d.address ?? "",
      notes: d.notes ?? "",
      stage: deliveryStage(mine, !!d.packedAt),
      minutes: minutesSince(c.opened_at, now),
      riderIn: d.riderAt ? Math.round((Date.parse(d.riderAt) - now.getTime()) / 60_000) : null,
      items: live.map(({ name, qty, modifiers, status, note }) => ({ name, qty, modifiers, status, note })),
      total: live.reduce((s, i) => s + (i.unit_price + i.modifiers.reduce((a, m) => a + (m.price ?? 0), 0)) * i.qty, 0),
      ready: live.filter((i) => i.status === "ready" || i.status === "delivered").length,
      count: live.length,
      checklist: packingList(live),
      packedBy: d.packedBy ?? null,
    };
  });
}

/** Pedido que entra por WhatsApp, teléfono o digitado desde la tablet de la plataforma. */
export async function createDelivery(staff: Staff, input: { channel: string; customer: string; code?: string; rider?: string; phone?: string; address?: string; notes?: string }) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede tomar domicilios");
  const biz = await getBusiness(staff.business_id);
  const channel = ["rappi", "didi", "propio"].includes(input.channel) ? input.channel : "propio";
  if (!biz.settings.channels[channel as "rappi" | "didi" | "propio"]) throw new UserError("Ese canal no está activo en este local");
  const customer = input.customer.trim().slice(0, 40);
  if (customer.length < 2) throw new UserError("Escribe el nombre del cliente");
  const phone = input.phone ? normalizePhone(input.phone) : "";
  if (channel === "propio" && phone.length !== 10) throw new UserError("Escribe el celular del cliente (10 números)");
  if (channel === "propio" && (input.address ?? "").trim().length < 5) throw new UserError("Escribe la dirección de entrega");
  const db = await getDb();
  return db.tx(async (tx) => {
    const number = await nextNumber(tx, staff.business_id, "check");
    const typed = (input.code ?? "").trim().replace(/\s+/g, "").slice(0, 16);
    const code = channel === "propio" ? `P-${number}` : typed || `${channel === "rappi" ? "R" : "D"}-${number}`;
    const delivery: Delivery = { code, phone, address: (input.address ?? "").trim().slice(0, 120), notes: (input.notes ?? "").trim().slice(0, 120) };
    // La tablet de la plataforma dice en cuánto llega el domiciliario: con eso la cocina prioriza
    const rider = Math.round(Number(input.rider));
    if (channel !== "propio" && rider >= 1 && rider <= 120) delivery.riderAt = new Date(Date.now() + rider * 60_000).toISOString();
    const row = await tx.one<{ id: string }>(
      "insert into checks (business_id, number, kind, channel, name, guests, opened_by, delivery) values ($1, $2, 'domicilio', $3, $4, 1, $5, $6::jsonb) returning id",
      [staff.business_id, number, channel, customer, staff.id, JSON.stringify(delivery)],
    );
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/** Cierra la bolsa: solo con todo listo y la lista revisada completa. Queda quién empacó. */
export async function packDelivery(staff: Staff, checkId: string, checked: string[]) {
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await loadCheck(staff.business_id, checkId, tx);
    if (!check || check.kind !== "domicilio") throw new UserError("Domicilio no encontrado");
    const stage = deliveryStage(check.items, !!check.delivery?.packedAt);
    if (stage === "listo") throw new UserError("Este pedido ya está empacado");
    if (stage !== "empacar") throw new UserError("Todavía hay productos en cocina");
    const list = packingList(check.items);
    const missing = list.filter((l) => !checked.includes(l));
    if (missing.length) throw new UserError(`Falta revisar: ${missing[0]}`);
    await tx.query("update check_items set status = 'delivered', delivered_at = now() where check_id = $1 and status = 'ready'", [checkId]);
    const packed = { ...(check.delivery ?? { code: "" }), packedAt: new Date().toISOString(), packedBy: staff.name, checklist: list };
    await tx.query("update checks set delivery = $2::jsonb, updated_at = now() where id = $1", [checkId, JSON.stringify(packed)]);
    await audit(tx, staff.business_id, staff.id, "pack", { code: packed.code, items: list.length });
    await bump(tx, staff.business_id);
  });
}

/** Entrega al domiciliario de la plataforma: queda pagado en la plataforma y sale la factura. */
export async function dispatchDelivery(staff: Staff, checkId: string) {
  if (!can.charge(staff)) throw new UserError("Tu usuario no puede despachar domicilios");
  const db = await getDb();
  await db.tx(async (tx) => {
    const check = await loadCheck(staff.business_id, checkId, tx);
    if (!check || check.kind !== "domicilio") throw new UserError("Domicilio no encontrado");
    if (!check.delivery?.packedAt) throw new UserError("Empaca y revisa el pedido antes de entregarlo");
    if (check.channel === "propio") throw new UserError("Cobra el domicilio propio en el cobro de la cuenta");
    // Queda en la caja del día como pagado en la plataforma: no entra al cajón, pero sí al cuadre de ventas
    const session = await currentCashSession(staff.business_id, tx);
    if (check.due > 0)
      await tx.query(
        "insert into payments (business_id, check_id, method, amount, tip, reference, created_by, cash_session_id) values ($1, $2, 'plataforma', $3, 0, $4, $5, $6)",
        [staff.business_id, checkId, check.due, check.delivery.code, staff.id, session?.id ?? null],
      );
  });
  return closeCheck(staff, checkId, { tipAnswer: "no", invoice: { kind: "consumidor" } });
}

/** Pantalla de turnos del mostrador: pedidos para llevar que se preparan y los que ya están listos. */
export async function counterOrders(bizId: string) {
  const db = await getDb();
  const rows = await db.query<{ id: string; number: number; name: string; status: string }>(
    `select c.id, c.number, c.name, i.status from checks c join check_items i on i.check_id = c.id
      where c.business_id = $1 and c.kind = 'llevar' and c.opened_at > now() - interval '6 hours' and i.status <> 'void'
      order by c.number`,
    [bizId],
  );
  const byCheck = new Map<string, { number: number; name: string; statuses: string[] }>();
  for (const r of rows) {
    const c = byCheck.get(r.id) ?? { number: r.number, name: r.name, statuses: [] };
    c.statuses.push(r.status);
    byCheck.set(r.id, c);
  }
  const preparing: { number: number; name: string }[] = [];
  const ready: { number: number; name: string }[] = [];
  for (const c of byCheck.values()) {
    if (c.statuses.some((s) => s === "sent")) preparing.push({ number: c.number, name: c.name });
    else if (c.statuses.some((s) => s === "ready")) ready.push({ number: c.number, name: c.name });
  }
  return { preparing, ready };
}
