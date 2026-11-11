import { describe, expect, it } from "vitest";
import { connectionProblems } from "../lib/db-core";

const levels = (url: string) => connectionProblems(url).map((p) => p.level);

describe("connectionProblems: la cadena de Supabase antes de conectar", () => {
  it("la del Transaction pooler pasa limpia", () => {
    expect(connectionProblems("postgresql://postgres.abcdefghijklmnop:Clave2026segura@aws-1-us-east-1.pooler.supabase.com:6543/postgres")).toEqual([]);
  });

  it("una base propia que no es de Supabase no lleva avisos", () => {
    expect(connectionProblems("postgres://ronda:clave@10.0.0.5:5432/ronda")).toEqual([]);
  });

  it("frena si la contraseña sigue siendo el texto de ejemplo", () => {
    expect(levels("postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-1-us-east-1.pooler.supabase.com:6543/postgres")).toEqual(["error"]);
  });

  it("frena si la cadena no es de Postgres o no se puede leer", () => {
    expect(levels("https://abcdefghijklmnop.supabase.co")).toEqual(["error"]);
    expect(levels("postgresql://postgres.abcdefghijklmnop:ab/cd@aws-1-us-east-1.pooler.supabase.com:6543/postgres")).toEqual(["error"]);
  });

  it("avisa con la conexión directa (Vercel no llega por IPv6)", () => {
    expect(levels("postgresql://postgres:Clave2026segura@db.abcdefghijklmnop.supabase.co:5432/postgres")).toEqual(["aviso"]);
  });

  it("avisa con el pooler en modo sesión y con el usuario sin el código del proyecto", () => {
    expect(levels("postgresql://postgres.abcdefghijklmnop:Clave2026segura@aws-1-us-east-1.pooler.supabase.com:5432/postgres")).toEqual(["aviso"]);
    expect(levels("postgresql://postgres:Clave2026segura@aws-1-us-east-1.pooler.supabase.com:6543/postgres")).toEqual(["aviso"]);
  });
});
