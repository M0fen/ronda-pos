import "server-only";
import QRCode from "qrcode";
import { cleanChannelPrices, cleanCode, cleanHiddenChannels } from "../core/channels";
import { mergeSettings, type Settings } from "../settings";
import { pinHash } from "../seed";
import { normalizePhone } from "../utils";
import { can, revokeSessions, type Staff } from "./auth";
import { audit, bump, getBusiness } from "./business";
import { getDb } from "./db";
import { UserError } from "./errors";

export async function updateProduct(
  staff: Staff,
  productId: string,
  patch: {
    name?: string;
    price?: number;
    happyPrice?: number | null;
    soldOut?: boolean;
    active?: boolean;
    description?: string;
    favorite?: boolean;
    categoryId?: string;
    station?: string;
    code?: string | null;
    channelPrices?: Record<string, number>;
    hiddenChannels?: string[];
  },
) {
  // Marcar agotado lo puede hacer cualquiera del equipo; el resto, el encargado
  const onlyStock = Object.keys(patch).every((k) => k === "soldOut");
  if (!onlyStock && !can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian la carta");
  const db = await getDb();
  await db.tx(async (tx) => {
    const p = await tx.one<{ id: string; name: string; price: number; happy_price: number | null }>("select id, name, price, happy_price from products where id = $1 and business_id = $2 for update", [
      productId,
      staff.business_id,
    ]);
    if (!p) throw new UserError("Producto no encontrado");
    if (patch.categoryId !== undefined) {
      const cat = await tx.one("select 1 from categories where id::text = $1 and business_id = $2", [String(patch.categoryId), staff.business_id]);
      if (!cat) throw new UserError("Elige una categoría");
      await tx.query("update products set category_id = $2 where id = $1", [productId, patch.categoryId]);
    }
    if (patch.station !== undefined) {
      if (patch.station !== "barra" && patch.station !== "cocina") throw new UserError("Elige barra o cocina");
      await tx.query("update products set station = $2 where id = $1", [productId, patch.station]);
    }
    if (patch.name !== undefined) {
      if (patch.name.trim().length < 2) throw new UserError("Escribe el nombre");
      await tx.query("update products set name = $2 where id = $1", [productId, patch.name.trim().slice(0, 60)]);
    }
    if (patch.description !== undefined) await tx.query("update products set description = $2 where id = $1", [productId, patch.description.trim().slice(0, 200)]);
    if (patch.price !== undefined) {
      const price = Math.round(patch.price);
      if (!Number.isFinite(price) || price <= 0 || price > 5_000_000) throw new UserError("El precio no puede quedar vacío ni en $0");
      if (patch.happyPrice === undefined && p.happy_price !== null && p.happy_price >= price)
        throw new UserError("El precio de happy hour quedaría igual o más alto: bájalo o bórralo primero");
      await tx.query("update products set price = $2 where id = $1", [productId, price]);
      if (price !== p.price) await audit(tx, staff.business_id, staff.id, "price", { product: p.name, from: p.price, to: price });
    }
    if (patch.happyPrice !== undefined) {
      const happy = patch.happyPrice && patch.happyPrice > 0 ? Math.round(patch.happyPrice) : null;
      const price = patch.price !== undefined ? Math.round(patch.price) : p.price;
      if (happy !== null && happy >= price) throw new UserError("El precio de happy hour tiene que ser menor que el precio normal");
      await tx.query("update products set happy_price = $2 where id = $1", [productId, happy]);
    }
    if (patch.code !== undefined) {
      const code = cleanCode(patch.code);
      if (code === "") throw new UserError("El código solo lleva letras, números, punto o guion (hasta 30)");
      if (code) {
        const taken = await tx.one<{ name: string }>("select name from products where business_id = $1 and lower(code) = lower($2) and id <> $3", [staff.business_id, code, productId]);
        if (taken) throw new UserError(`El código ${code} ya lo tiene ${taken.name}`);
      }
      await tx.query("update products set code = $2 where id = $1", [productId, code]);
    }
    if (patch.channelPrices !== undefined) {
      const prices = cleanChannelPrices(patch.channelPrices);
      await tx.query("update products set channel_prices = $2::jsonb where id = $1", [productId, JSON.stringify(prices)]);
      await audit(tx, staff.business_id, staff.id, "channel_prices", { product: p.name, prices });
    }
    if (patch.hiddenChannels !== undefined) await tx.query("update products set hidden_channels = $2::jsonb where id = $1", [productId, JSON.stringify(cleanHiddenChannels(patch.hiddenChannels))]);
    if (patch.soldOut !== undefined) await tx.query("update products set sold_out = $2 where id = $1", [productId, patch.soldOut]);
    if (patch.active !== undefined) await tx.query("update products set active = $2 where id = $1", [productId, patch.active]);
    if (patch.favorite !== undefined) await tx.query("update products set favorite = $2 where id = $1", [productId, patch.favorite]);
    await bump(tx, staff.business_id);
  });
}

export async function createProduct(staff: Staff, input: { name: string; categoryId: string; price: number }) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian la carta");
  const name = input.name.trim();
  if (name.length < 2) throw new UserError("Escribe el nombre");
  const price = Math.round(Number(input.price));
  if (!Number.isFinite(price) || price <= 0 || price > 5_000_000) throw new UserError("Revisa el precio");
  const biz = await getBusiness(staff.business_id);
  const db = await getDb();
  return db.tx(async (tx) => {
    const cat = await tx.one<{ station: string }>("select station from categories where id = $1 and business_id = $2", [input.categoryId, staff.business_id]);
    if (!cat) throw new UserError("Elige una categoría");
    const row = await tx.one<{ id: string }>(
      "insert into products (business_id, category_id, name, price, station, sort, tax_rate) values ($1, $2, $3, $4, $5, 999, $6) returning id",
      [staff.business_id, input.categoryId, name.slice(0, 60), price, cat.station, biz.settings.tax.rate],
    );
    await bump(tx, staff.business_id);
    return row!.id;
  });
}

/** Pone la tarifa del impuesto a todos los productos de la carta (por ejemplo, una sede que factura al 0 % o al 19 %). */
export async function applyTaxToMenu(staff: Staff, rate: number) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian la carta");
  const r = Number(rate);
  if (!Number.isFinite(r) || r < 0 || r > 19) throw new UserError("La tarifa va de 0 a 19 %");
  const db = await getDb();
  await db.tx(async (tx) => {
    const rows = await tx.query("update products set tax_rate = $2 where business_id = $1 returning id", [staff.business_id, r]);
    await audit(tx, staff.business_id, staff.id, "tax_rate", { rate: r, products: rows.length });
    await bump(tx, staff.business_id);
  });
}

export async function listStaff(bizId: string) {
  const db = await getDb();
  return db.query<{ id: string; name: string; role: string; color: string; active: boolean; pay_kind: "salario" | "hora"; pay_amount: number; locked: boolean; pin_len: number }>(
    "select id, name, role, color, active, pay_kind, pay_amount, (locked_until is not null and locked_until > now()) as locked, pin_len from staff where business_id = $1 order by active desc, created_at",
    [bizId],
  );
}

const HIGH: string[] = ["owner", "admin"];

/**
 * Equipo: el dueño maneja a todos; la administración solo maneja caja, meseros y barra (y su propio nombre y PIN).
 * Ninguna sede queda sin dueño ni administración activos. Dueño y administración usan PIN de 6 números.
 */
export async function saveStaff(actor: Staff, input: { id?: string; name: string; role: string; pin?: string; active?: boolean; payKind?: string; payAmount?: number }) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador manejan el equipo");
  const name = (input.name ?? "").trim();
  if (name.length < 2) throw new UserError("Escribe el nombre");
  if (!["owner", "admin", "cashier", "waiter", "bar"].includes(input.role)) throw new UserError("Elige un rol");
  const pin = input.pin ?? "";
  const payKind = input.payKind === "hora" ? "hora" : "salario";
  const payAmount = Math.round(Number(input.payAmount ?? 0));
  if (!Number.isFinite(payAmount) || payAmount < 0 || payAmount > (payKind === "hora" ? 500_000 : 100_000_000)) throw new UserError(payKind === "hora" ? "Revisa el valor de la hora" : "Revisa el salario");
  const db = await getDb();
  await db.tx(async (tx) => {
    const current = input.id
      ? await tx.one<{ id: string; name: string; role: string; active: boolean; pin_len: number; pay_kind: string; pay_amount: number }>(
          "select id, name, role, active, pin_len, pay_kind, pay_amount from staff where id = $1 and business_id = $2 for update",
          [input.id, actor.business_id],
        )
      : null;
    if (input.id && !current) throw new UserError("Persona no encontrada");
    const self = current?.id === actor.id;
    if (actor.role !== "owner") {
      if (HIGH.includes(input.role) && !(self && current?.role === input.role)) throw new UserError("Solo el dueño asigna los roles de dueño y administrador");
      if (current && HIGH.includes(current.role) && !self) throw new UserError("Solo el dueño edita a otro dueño o administrador");
    }
    if (self && input.active === false) throw new UserError("No puedes desactivarte a ti mismo");
    const high = HIGH.includes(input.role);
    if (pin && !/^\d+$/.test(pin)) throw new UserError("El PIN es solo de números");
    if (pin && high && pin.length !== 6) throw new UserError("Dueño y administración usan un PIN de 6 números");
    if (pin && !high && pin.length !== 4) throw new UserError("El PIN es de 4 números");
    if (!pin && !current) throw new UserError(high ? "Asigna un PIN de 6 números" : "Asigna un PIN de 4 números");
    if (!pin && current && high && !HIGH.includes(current.role)) throw new UserError("Para subir a dueño o administración, asigna un PIN de 6 números");

    let id = current?.id;
    if (current) {
      await tx.query("update staff set name = $2, role = $3, active = coalesce($4, active), pay_kind = $5, pay_amount = $6 where id = $1", [
        current.id,
        name.slice(0, 40),
        input.role,
        input.active ?? null,
        payKind,
        payAmount,
      ]);
      if (pin) await tx.query("update staff set pin_hash = $2, pin_len = $3, pin_fails = 0, locked_until = null where id = $1", [current.id, pinHash(current.id, pin), pin.length]);
      // Los turnos abiertos o que quedaron en $0 toman el pago nuevo: no se quedan en cero sin que nadie lo note
      if (current.pay_kind !== payKind || current.pay_amount !== payAmount) {
        await tx.query("update shifts set pay_kind = $2, pay_amount = $3 where staff_id = $1 and (clock_out is null or pay_amount = 0)", [current.id, payKind, payAmount]);
      }
      if (pin || current.role !== input.role || input.active === false) await revokeSessions(tx, current.id);
    } else {
      id = crypto.randomUUID();
      const count = await tx.one<{ n: number }>("select count(*)::int as n from staff where business_id = $1", [actor.business_id]);
      await tx.query("insert into staff (id, business_id, name, role, pin_hash, pin_len, color, pay_kind, pay_amount) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [
        id,
        actor.business_id,
        name.slice(0, 40),
        input.role,
        pinHash(id, pin),
        pin.length,
        ["#1E4FB8", "#0B7A55", "#D2232A", "#B07800", "#7A4A2A", "#9B3D8F"][(count?.n ?? 0) % 6],
        payKind,
        payAmount,
      ]);
    }
    const leaders = await tx.one<{ n: number }>("select count(*)::int as n from staff where business_id = $1 and active and role in ('owner','admin')", [actor.business_id]);
    if (!leaders?.n) throw new UserError("La sede no puede quedar sin dueño ni administrador activo");
    await audit(tx, actor.business_id, actor.id, "staff", {
      name,
      role: input.role,
      fromRole: current?.role ?? null,
      pinChanged: !!pin,
      active: input.active ?? current?.active ?? true,
      payKind,
      payAmount,
      new: !current,
    });
    await bump(tx, actor.business_id);
    return id;
  });
}

/** Desbloquea el PIN de alguien que se bloqueó por intentos fallidos. */
export async function unlockStaff(actor: Staff, staffId: string) {
  if (!can.manage(actor)) throw new UserError("Solo el dueño o el administrador desbloquean un PIN");
  const db = await getDb();
  await db.tx(async (tx) => {
    const s = await tx.one<{ name: string; role: string }>("select name, role from staff where id = $1 and business_id = $2", [staffId, actor.business_id]);
    if (!s) throw new UserError("Persona no encontrada");
    if (actor.role !== "owner" && HIGH.includes(s.role) && staffId !== actor.id) throw new UserError("Solo el dueño desbloquea a otro dueño o administrador");
    await tx.query("update staff set pin_fails = 0, locked_until = null where id = $1", [staffId]);
    await audit(tx, actor.business_id, actor.id, "pin_unlocked", { name: s.name });
  });
}

function inRange(value: number, min: number, max: number, label: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new UserError(`Revisa ${label}: va de ${min.toLocaleString("es-CO")} a ${max.toLocaleString("es-CO")}`);
}

/** Ajustes con rangos y errores claros. Lo que compara las sedes (comisiones y carga del equipo) es del dueño. */
export async function saveSettings(staff: Staff, next: Settings) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador cambian los ajustes");
  const raw = next as unknown as Record<string, Record<string, unknown>>;
  const num = (group: string, key: string) => {
    const v = raw?.[group]?.[key];
    return v === null || v === undefined || v === "" ? Number.NaN : Number(v);
  };
  // Lo que llega se revisa antes de mezclar: un número borrado o fuera de rango es un error, no un 0 silencioso
  inRange(num("tax", "rate"), 0, 19, "la tarifa del impuesto");
  const tipPct = num("tips", "suggestedPct");
  if (Number.isFinite(tipPct) && tipPct > 10) throw new UserError("La propina sugerida no puede pasar del 10 % (Ley 1935 de 2018)");
  inRange(tipPct, 0, 10, "la propina sugerida");
  inRange(num("loyalty", "goal"), 1, 50, "los sellos para el premio");
  inRange(num("loyalty", "minPurchase"), 0, 10_000_000, "la compra mínima para el sello");
  inRange(num("loyalty", "rewardMax"), 0, 1_000_000, "el tope del premio");
  inRange(num("alerts", "voidLimit"), 0, 10_000_000, "el aviso de anulaciones");
  inRange(num("alerts", "discountLimitPct"), 0, 100, "el descuento sin autorización");
  inRange(num("channels", "rappiPct"), 0, 50, "la comisión de Rappi");
  inRange(num("channels", "didiPct"), 0, 50, "la comisión de DiDi");
  inRange(num("labor", "alertPct"), 10, 60, "la alerta de mano de obra");
  inRange(num("labor", "arlClass"), 1, 5, "la clase de riesgo ARL");
  inRange(num("security", "lockMinutes"), 0, 120, "el bloqueo por inactividad");
  for (const st of ["barra", "cocina"]) {
    inRange(num("kds", `${st}Warn`), 1, 60, `el aviso amarillo de ${st}`);
    inRange(num("kds", `${st}Late`), 2, 120, `el aviso rojo de ${st}`);
    if (num("kds", `${st}Late`) <= num("kds", `${st}Warn`)) throw new UserError(`En ${st}, el rojo tiene que llegar después del amarillo`);
  }
  for (const k of ["rangeFrom", "rangeTo"]) inRange(num("invoice", k), 0, 999_999_999, "el rango de facturación");
  const clean = mergeSettings(next);
  for (const key of ["primary", "accent"] as const) if (!/^#[0-9a-fA-F]{6}$/.test(clean.theme[key])) throw new UserError("Revisa los colores (formato #RRGGBB)");
  if (clean.business.name.trim().length < 2) throw new UserError("Escribe el nombre del local");
  if (!clean.invoice.prefix) throw new UserError("Escribe el prefijo de facturación (letras y números, hasta 4)");
  if (clean.invoice.rangeFrom && clean.invoice.rangeTo && clean.invoice.rangeFrom > clean.invoice.rangeTo) throw new UserError("Revisa el rango de facturación: el inicio es mayor que el final");
  if (clean.invoice.validFrom && clean.invoice.validTo && clean.invoice.validFrom > clean.invoice.validTo) throw new UserError("Revisa la vigencia de la resolución");
  clean.alerts.ownerWhatsapp = normalizePhone(clean.alerts.ownerWhatsapp);
  const current = await getBusiness(staff.business_id);
  const prev = current.settings;
  const chainKeys = [
    ["channels", "rappiPct"],
    ["channels", "didiPct"],
    ["labor", "exonerated"],
    ["labor", "arlClass"],
  ] as const;
  const chainChanges = chainKeys.filter(([g, k]) => (prev[g] as Record<string, unknown>)[k] !== (clean[g] as Record<string, unknown>)[k]);
  if (chainChanges.length && staff.role !== "owner") throw new UserError("Solo el dueño cambia las comisiones de las plataformas y la carga del equipo");
  const db = await getDb();
  await db.tx(async (tx) => {
    if (current.chainId) {
      const taken = await tx.one<{ sede: string }>("select sede from businesses where chain_id = $1 and id <> $2 and settings->'invoice'->>'prefix' = $3", [current.chainId, staff.business_id, clean.invoice.prefix]);
      if (taken) throw new UserError(`El prefijo ${clean.invoice.prefix} ya lo usa la sede ${taken.sede}: cada sede factura con el suyo`);
    }
    await tx.query("update businesses set name = $2, settings = $3::jsonb where id = $1", [staff.business_id, clean.business.name.trim(), JSON.stringify(clean)]);
    // La numeración arranca en el rango de la resolución
    if (clean.invoice.rangeFrom) {
      await tx.query(
        `insert into counters (business_id, kind, last) values ($1, 'invoice', $2)
         on conflict (business_id, kind) do update set last = greatest(counters.last, excluded.last)`,
        [staff.business_id, clean.invoice.rangeFrom - 1],
      );
    }
    await audit(tx, staff.business_id, staff.id, "settings", {
      changes: chainChanges.map(([g, k]) => ({ key: `${g}.${k}`, from: (prev[g] as Record<string, unknown>)[k], to: (clean[g] as Record<string, unknown>)[k] })),
      prefix: clean.invoice.prefix !== prev.invoice.prefix ? { from: prev.invoice.prefix, to: clean.invoice.prefix } : undefined,
    });
    await bump(tx, staff.business_id);
  });
}

export async function tableQrs(bizId: string, origin: string) {
  const db = await getDb();
  const tables = await db.query<{ id: string; name: string; qr_token: string; zone: string }>(
    "select t.id, t.name, t.qr_token, z.name as zone from floor_tables t join zones z on z.id = t.zone_id where t.business_id = $1 and t.active order by z.sort, t.name",
    [bizId],
  );
  return Promise.all(
    tables.map(async (t) => {
      const url = `${origin}/m/${t.qr_token}`;
      return { ...t, url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#24150F", light: "#FFFFFF" } }) };
    }),
  );
}

export async function customersView(bizId: string, goal: number) {
  const db = await getDb();
  const rows = await db.query<{
    id: string;
    name: string;
    phone: string;
    stamps: number;
    visits: number;
    total_spent: number;
    last_visit: string | null;
    birthday: string | null;
    consent_at: string | null;
    consent_withdrawn_at: string | null;
  }>(
    "select id, name, phone, stamps, visits, total_spent, last_visit, birthday, consent_at, consent_withdrawn_at from customers where business_id = $1 order by last_visit desc nulls last",
    [bizId],
  );
  const now = Date.now();
  const month = new Date(now - 5 * 3_600_000).toISOString().slice(5, 7);
  return rows.map((r) => ({
    ...r,
    /** Autorizó y no ha retirado la autorización: solo a ellos se les escribe (Ley 1581) */
    consented: !!r.consent_at && !r.consent_withdrawn_at,
    inactive: r.last_visit ? now - new Date(r.last_visit).getTime() > 30 * 86_400_000 : true,
    nearReward: r.stamps >= goal - 1,
    birthdayMonth: !!r.birthday && r.birthday.startsWith(month),
    frequent: r.visits >= 8,
  }));
}

/** Ley 1581: el cliente retira su autorización. Sigue sumando sellos solo si vuelve a autorizar; no recibe mensajes. */
export async function withdrawConsent(staff: Staff, customerId: string) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador manejan los datos de los clientes");
  const db = await getDb();
  await db.tx(async (tx) => {
    const c = await tx.one<{ phone: string }>("update customers set consent_withdrawn_at = now() where id = $1 and business_id = $2 returning phone", [customerId, staff.business_id]);
    if (!c) throw new UserError("Cliente no encontrado");
    await audit(tx, staff.business_id, staff.id, "consent_withdrawn", { phone: `${c.phone.slice(0, 3)}•••${c.phone.slice(-2)}` });
  });
}

/** Ley 1581: el cliente pide que borren sus datos. Se borra su ficha y sus sellos; las facturas quedan por obligación legal. */
export async function deleteCustomer(staff: Staff, customerId: string) {
  if (!can.manage(staff)) throw new UserError("Solo el dueño o el administrador manejan los datos de los clientes");
  const db = await getDb();
  await db.tx(async (tx) => {
    const c = await tx.one<{ phone: string }>("delete from customers where id = $1 and business_id = $2 returning phone", [customerId, staff.business_id]);
    if (!c) throw new UserError("Cliente no encontrado");
    await audit(tx, staff.business_id, staff.id, "customer_deleted", { phone: `${c.phone.slice(0, 3)}•••${c.phone.slice(-2)}` });
  });
}
