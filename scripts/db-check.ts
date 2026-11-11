/**
 * Revisa la base de datos de un local antes de publicarlo: la cadena de conexión, la conexión segura, las tablas
 * y la API de datos de Supabase. Si todo está bien, crea las tablas (las mismas migraciones que corre la app) y
 * dice qué variables poner en Vercel.
 *
 * Uso: DATABASE_URL="postgresql://postgres.xxxx:clave@aws-1-us-east-1.pooler.supabase.com:6543/postgres" npm run db:check
 */
import { randomBytes } from "node:crypto";
import { connect, connectionProblems, databaseUrl } from "../lib/db-core";

const ok = (text: string) => console.log(`  ✓ ${text}`);
const warn = (text: string) => console.log(`  ! ${text}`);

function stop(text: string): never {
  console.log(`\n  ✗ ${text}\n`);
  process.exit(1);
}

async function main() {
  console.log("\nRonda · revisión de la base de datos\n");
  const url = databaseUrl();
  if (!url) stop('Falta DATABASE_URL. En Supabase: Connect → Transaction pooler → copia la cadena y corre: DATABASE_URL="…" npm run db:check');
  if (process.env.DEMO_MODE === "true") stop("DEMO_MODE=true sembraría el ejemplo de Sr. Patata en esta base. Quítalo para el local real.");

  const problems = connectionProblems(url);
  for (const p of problems) (p.level === "error" ? stop : warn)(p.text);
  const host = new URL(url).hostname;
  ok(`Cadena válida (${host})`);

  let db: Awaited<ReturnType<typeof connect>>;
  try {
    db = await connect();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password authentication failed/i.test(message)) stop("La contraseña no coincide. En Supabase: Database → Settings → Reset database password, y cámbiala en la cadena.");
    if (/ENOTFOUND|ENETUNREACH|EHOSTUNREACH/i.test(message)) stop(`No se llega a ${host}. Revisa que sea la cadena de Transaction pooler.`);
    if (/certificate/i.test(message)) {
      stop(
        `La conexión segura no se pudo verificar (${message}). Descarga el certificado del proveedor (en Supabase: Database → Settings → SSL Configuration → Download certificate) y pon su contenido en PGSSL_CA.`,
      );
    }
    if (/Tenant or user not found/i.test(message)) stop("Supabase no reconoce el usuario: copia otra vez la cadena completa desde Connect (el usuario es postgres.códigodelproyecto).");
    stop(`No se pudo conectar: ${message}`);
  }
  ok("Conexión segura verificada");

  const [server, version, tables, businesses, open] = await Promise.all([
    db.one<{ v: string }>("select current_setting('server_version') as v"),
    db.one<{ v: number }>("select max(version) as v from schema_version"),
    db.one<{ n: number }>("select count(*)::int as n from pg_tables where schemaname = current_schema()"),
    db.one<{ n: number }>("select count(*)::int as n from businesses"),
    db.query<{ t: string }>(
      "select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() and c.relkind = 'r' and not c.relrowsecurity",
    ),
  ]);
  ok(`Postgres ${server?.v} · ${tables?.n} tablas · esquema en la versión ${version?.v}`);
  if (open.length) warn(`Estas tablas quedaron sin seguridad por filas (no son de este usuario): ${open.map((o) => o.t).join(", ")}`);
  else ok("La API de datos de Supabase no ve ni cambia nada (seguridad por filas en todas las tablas)");
  if (businesses?.n) ok(`Ya tiene ${businesses.n} ${businesses.n === 1 ? "local" : "locales"}: el alta ya se hizo`);
  else ok("Base vacía: al abrir la app, /entrar lleva al alta del local");

  const secret = process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32 ? null : randomBytes(32).toString("base64url");
  const setup = process.env.SETUP_TOKEN && process.env.SETUP_TOKEN.trim().length >= 12 ? null : randomBytes(9).toString("base64url");
  console.log("\nVariables para el proyecto en Vercel (Settings → Environment Variables, en Production):\n");
  console.log("  DATABASE_URL    la misma cadena que acabas de revisar");
  console.log(`  SESSION_SECRET  ${secret ?? "(la que ya tienes)"}`);
  console.log(`  SETUP_TOKEN     ${setup ?? "(el que ya tienes)"}`);
  console.log("\nSin DEMO_MODE. Después de guardar, vuelve a desplegar y manda el enlace del alta:");
  console.log(`  https://<dirección del local>/alta?codigo=${setup ?? "<SETUP_TOKEN>"}\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => stop(error instanceof Error ? error.message : String(error)));
