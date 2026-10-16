/**
 * Migraciones SQL. Nunca edites una publicada: agrega otra al final.
 * Cada sentencia termina en ";" + salto de línea (así las separa db-core).
 * Todas las tablas llevan business_id: el mismo sistema sirve a varios locales.
 */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
create table businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  role text not null check (role in ('owner','admin','cashier','waiter','bar')),
  pin_hash text not null,
  color text not null default '#1E4FB8',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_business on staff (business_id);

create table zones (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  sort int not null default 0
);

create table floor_tables (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  zone_id uuid not null references zones(id) on delete cascade,
  name text not null,
  seats int not null default 4,
  x int not null default 0,
  y int not null default 0,
  shape text not null default 'square',
  qr_token text not null unique,
  active boolean not null default true
);
create index floor_tables_business on floor_tables (business_id);

create table categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  color text not null default '#1E4FB8',
  station text not null default 'barra',
  sort int not null default 0
);

create table products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  category_id uuid not null references categories(id) on delete restrict,
  name text not null,
  description text not null default '',
  price int not null check (price >= 0),
  happy_price int check (happy_price >= 0),
  tax_rate numeric(5,2) not null default 8,
  station text not null default 'barra',
  image text,
  active boolean not null default true,
  sold_out boolean not null default false,
  favorite boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index products_business on products (business_id, category_id);

create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  min_select int not null default 0,
  max_select int not null default 1,
  sort int not null default 0
);

create table modifiers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  group_id uuid not null references modifier_groups(id) on delete cascade,
  name text not null,
  price int not null default 0,
  is_default boolean not null default false,
  sort int not null default 0
);

create table product_modifier_groups (
  product_id uuid not null references products(id) on delete cascade,
  group_id uuid not null references modifier_groups(id) on delete cascade,
  sort int not null default 0,
  primary key (product_id, group_id)
);

create table customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  phone text not null,
  name text not null default '',
  birthday text,
  consent_at timestamptz,
  stamps int not null default 0,
  visits int not null default 0,
  total_spent int not null default 0,
  last_visit timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, phone)
);

create sequence check_number_seq start 101;

create table checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  number int not null default nextval('check_number_seq'),
  table_id uuid references floor_tables(id) on delete set null,
  kind text not null default 'mesa' check (kind in ('mesa','barra','llevar')),
  name text not null default '',
  guests int not null default 2,
  status text not null default 'open' check (status in ('open','bill','paid','void')),
  opened_by uuid references staff(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references staff(id) on delete set null,
  closed_at timestamptz,
  customer_id uuid references customers(id) on delete set null,
  discount_pct int not null default 0,
  discount_reason text,
  tip_answer text,
  note text not null default '',
  updated_at timestamptz not null default now()
);
create index checks_open on checks (business_id, status);
create index checks_closed on checks (business_id, closed_at);

create table check_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  check_id uuid not null references checks(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  name text not null,
  unit_price int not null,
  qty int not null check (qty > 0),
  modifiers jsonb not null default '[]'::jsonb,
  note text not null default '',
  station text not null default 'barra',
  tax_rate numeric(5,2) not null default 8,
  status text not null default 'draft' check (status in ('draft','sent','ready','delivered','void')),
  round int not null default 0,
  courtesy boolean not null default false,
  source text not null default 'staff',
  added_by uuid references staff(id) on delete set null,
  sent_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  void_reason text,
  void_by uuid references staff(id) on delete set null,
  void_waste boolean not null default false,
  created_at timestamptz not null default now()
);
create index check_items_check on check_items (check_id);
create index check_items_kds on check_items (business_id, status, station);

create table cash_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  opened_by uuid references staff(id) on delete set null,
  opened_at timestamptz not null default now(),
  opening int not null default 0,
  closed_by uuid references staff(id) on delete set null,
  closed_at timestamptz,
  counted int,
  expected int,
  difference int,
  note text not null default ''
);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  session_id uuid not null references cash_sessions(id) on delete cascade,
  kind text not null check (kind in ('in','out')),
  amount int not null check (amount > 0),
  reason text not null,
  staff_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  check_id uuid not null references checks(id) on delete cascade,
  method text not null check (method in ('efectivo','nequi','breb','tarjeta','daviplata')),
  amount int not null check (amount >= 0),
  tip int not null default 0,
  received int,
  reference text not null default '',
  part text not null default '',
  status text not null default 'ok' check (status in ('ok','pending','rejected')),
  created_by uuid references staff(id) on delete set null,
  cash_session_id uuid references cash_sessions(id) on delete set null,
  created_at timestamptz not null default now()
);
create index payments_check on payments (check_id);
create index payments_day on payments (business_id, created_at);

create sequence invoice_number_seq start 1001;

create table invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  check_id uuid not null references checks(id) on delete cascade,
  number int not null default nextval('invoice_number_seq'),
  prefix text not null default 'FEVV',
  cufe text not null,
  public_token text not null unique,
  kind text not null default 'consumidor',
  customer_doc text,
  customer_name text,
  customer_email text,
  subtotal int not null,
  tax int not null,
  tip int not null default 0,
  total int not null,
  status text not null default 'validada',
  created_at timestamptz not null default now()
);

create table ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  unit text not null check (unit in ('g','ml','und')),
  stock numeric(12,2) not null default 0,
  min_stock numeric(12,2) not null default 0,
  cost numeric(12,4) not null default 0,
  pack_size numeric(12,2),
  pack_label text,
  kind text not null default 'insumo'
);

create table recipe_items (
  business_id uuid not null references businesses(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  qty numeric(12,2) not null check (qty > 0),
  primary key (product_id, ingredient_id)
);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  delta numeric(12,2) not null,
  reason text not null check (reason in ('venta','compra','merma','ajuste','conteo','anulacion')),
  ref text not null default '',
  staff_id uuid references staff(id) on delete set null,
  created_at timestamptz not null default now()
);
create index stock_movements_ing on stock_movements (ingredient_id, created_at);

create table loyalty_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  delta int not null,
  reason text not null,
  check_id uuid references checks(id) on delete set null,
  created_at timestamptz not null default now()
);

create table requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  table_id uuid references floor_tables(id) on delete cascade,
  check_id uuid references checks(id) on delete set null,
  kind text not null check (kind in ('order','waiter','bill','payment')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','done','rejected')),
  created_at timestamptz not null default now(),
  handled_by uuid references staff(id) on delete set null,
  handled_at timestamptz
);
create index requests_pending on requests (business_id, status);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  staff_id uuid references staff(id) on delete set null,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  amount int not null default 0,
  created_at timestamptz not null default now()
);
create index audit_business on audit_log (business_id, created_at);

create table pulse (
  business_id uuid primary key references businesses(id) on delete cascade,
  version bigint not null default 0
);
`,
  },
];
