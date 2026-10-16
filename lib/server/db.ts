import "server-only";
import { connect, isDemoMode, isEphemeralDb, type Db } from "../db-core";
import { seedActivity, seedBusiness } from "../seed";

export { isDemoMode, isEphemeralDb };
export type { Db, Tx } from "../db-core";

async function bootstrap(db: Db) {
  const row = await db.one<{ n: number }>("select count(*)::int as n from businesses");
  if (!row?.n && isDemoMode()) {
    await seedBusiness(db);
    await seedActivity(db);
  }
}

export function getDb() {
  return connect(bootstrap);
}

/** Borra todo y vuelve a cargar el café bar de ejemplo. Solo en modo demo. */
export async function resetDemo() {
  if (!isDemoMode()) throw new Error("Solo disponible en modo demo");
  const db = await getDb();
  await db.exec("truncate businesses restart identity cascade");
  await db.exec("alter sequence check_number_seq restart with 101; alter sequence invoice_number_seq restart with 1001");
  await seedBusiness(db);
  await seedActivity(db);
}
