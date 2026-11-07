import { describe, expect, it } from "vitest";
import { costShifts, fmtHours, holidayName, holidays, hourCost, jornadaOf, laborAlerts, laborRules, loadRate, sortTurnos, turnoAt, weekOf, type ShiftIn } from "../lib/core/labor";

const MIN_WAGE = 1_750_905;
const settings = { exonerated: true, arlClass: 1 };
const at = (local: string) => new Date(`${local}:00-05:00`).toISOString();
const shift = (id: string, from: string, to: string | null, pay: Partial<ShiftIn> = {}): ShiftIn => ({
  id,
  staffId: pay.staffId ?? "ana",
  start: at(from),
  end: to ? at(to) : null,
  payKind: pay.payKind ?? "salario",
  payAmount: pay.payAmount ?? MIN_WAGE,
});

describe("reglas con fecha de vigencia", () => {
  it("noviembre de 2026: mínimo, auxilio, 42 horas, nocturno desde las 7 y dominical al 90 %", () => {
    expect(laborRules("2026-11-07")).toMatchObject({ smmlv: 1_750_905, transport: 249_095, weeklyHours: 42, divisor: 210, nightFrom: 19, rest: 0.9 });
  });

  it("cada cambio entra el día que dice la ley", () => {
    expect(laborRules("2026-06-30")).toMatchObject({ rest: 0.8, weeklyHours: 44, divisor: 220 });
    expect(laborRules("2026-07-14")).toMatchObject({ rest: 0.9, divisor: 220 });
    expect(laborRules("2025-12-24").nightFrom).toBe(21);
    expect(laborRules("2025-12-25").nightFrom).toBe(19);
    expect(laborRules("2027-07-01").rest).toBe(1);
  });
});

describe("festivos", () => {
  it("2026 tiene los 18 festivos de Colombia, con la Ley Emiliani", () => {
    expect([...holidays(2026).keys()].sort()).toEqual([
      "2026-01-01", "2026-01-12", "2026-03-23", "2026-04-02", "2026-04-03", "2026-05-01", "2026-05-18", "2026-06-08", "2026-06-15",
      "2026-06-29", "2026-07-20", "2026-08-07", "2026-08-17", "2026-10-12", "2026-11-02", "2026-11-16", "2026-12-08", "2026-12-25",
    ]);
    expect(holidayName("2026-11-02")).toBe("Todos los Santos");
    expect(holidayName("2026-11-03")).toBeNull();
  });

  it("Semana Santa de 2027 se calcula desde la Pascua", () => {
    expect(holidayName("2027-03-25")).toBe("Jueves Santo");
    expect(holidayName("2027-03-26")).toBe("Viernes Santo");
  });
});

describe("carga sobre el salario", () => {
  it("38,4 % con exoneración y ARL clase I; 51,9 % sin exoneración", () => {
    expect(loadRate(settings)).toBeCloseTo(0.3836, 4);
    expect(loadRate({ exonerated: false, arlClass: 1 })).toBeCloseTo(0.5186, 4);
  });

  it("la hora del mínimo con todo encima", () => {
    expect(Math.round(hourCost("salario", MIN_WAGE, settings, "2026-11-04"))).toBe(12931);
    expect(hourCost("hora", 13000, settings, "2026-11-04")).toBe(13000);
  });
});

describe("costo de un turno", () => {
  it("8 horas de día entre semana: todo ordinario", () => {
    const { shifts } = costShifts([shift("a", "2026-11-04T10:00", "2026-11-04T18:00")], settings);
    expect(shifts[0]!.minutes).toBe(480);
    expect(shifts[0]!.split.ordinary).toBe(480);
    expect(Math.round(shifts[0]!.wage)).toBe(66701);
    expect(Math.round(shifts[0]!.total)).toBe(103450);
  });

  it("viernes de 5 p. m. a 1 a. m.: dos horas de día y seis nocturnas", () => {
    const { shifts } = costShifts([shift("a", "2026-11-06T17:00", "2026-11-07T01:00")], settings);
    expect(shifts[0]!.split).toMatchObject({ ordinary: 120, night: 360, rest: 0 });
    expect(shifts[0]!.wage).toBeCloseTo((MIN_WAGE / 210) * (2 + 6 * 1.35), 0);
    expect(shifts[0]!.jornada).toBe("2026-11-06");
  });

  it("domingo de 5 p. m. a 1 a. m.: dominical, dominical nocturno y lunes nocturno", () => {
    const { shifts } = costShifts([shift("a", "2026-11-08T17:00", "2026-11-09T01:00")], settings);
    expect(shifts[0]!.split).toMatchObject({ rest: 120, restNight: 300, night: 60 });
    expect(shifts[0]!.wage).toBeCloseTo((MIN_WAGE / 210) * (2 * 1.9 + 5 * 2.25 + 1 * 1.35), 0);
    expect(shifts[0]!.restDays).toEqual(["2026-11-08"]);
  });

  it("un festivo cuenta como domingo", () => {
    const { shifts } = costShifts([shift("a", "2026-11-02T11:00", "2026-11-02T18:00")], settings);
    expect(shifts[0]!.split.rest).toBe(420);
  });

  it("pasar de 42 horas en la semana vuelve extra lo que sobra", () => {
    const week = ["09", "10", "11", "12", "13", "14"].map((d) => shift(d, `2026-11-${d}T10:00`, `2026-11-${d}T18:00`));
    const cost = costShifts(week, settings);
    const saturday = cost.shifts.find((s) => s.id === "14")!;
    expect(saturday.split).toMatchObject({ ordinary: 120, extra: 360 });
    expect(cost.weeks[0]).toMatchObject({ week: "2026-11-09", minutes: 48 * 60, extra: 360, legal: true });
  });

  it("más de 9 horas en un día son extra", () => {
    const cost = costShifts([shift("a", "2026-11-04T10:00", "2026-11-04T22:00")], settings);
    expect(cost.shifts[0]!.split).toMatchObject({ ordinary: 540, extraNight: 180 });
    expect(cost.days[0]).toMatchObject({ jornada: "2026-11-04", minutes: 720, extra: 180, over: 180 });
  });

  it("por horas: valor fijo, sin recargos ni carga", () => {
    const { shifts } = costShifts([shift("a", "2026-11-08T17:00", "2026-11-08T23:00", { payKind: "hora", payAmount: 13000 })], settings);
    expect(shifts[0]!.total).toBeCloseTo(78000, 6);
    expect(shifts[0]!.load).toBe(0);
  });

  it("más de dos mínimos no lleva auxilio de transporte", () => {
    const { shifts } = costShifts([shift("a", "2026-11-04T10:00", "2026-11-04T18:00", { payAmount: 4_000_000 })], settings);
    expect(shifts[0]!.transport).toBe(0);
  });

  it("un turno abierto se cuenta hasta ahora y, si se olvidó, hasta 16 horas", () => {
    const now = new Date(at("2026-11-04T14:30"));
    expect(costShifts([shift("a", "2026-11-04T10:00", null)], { ...settings, now }).shifts[0]).toMatchObject({ minutes: 270, open: true, capped: false });
    const late = new Date(at("2026-11-05T14:30"));
    expect(costShifts([shift("a", "2026-11-04T10:00", null)], { ...settings, now: late }).shifts[0]).toMatchObject({ minutes: 960, capped: true });
  });

  it("reparte el costo por franja", () => {
    const turnos = sortTurnos([{ name: "Noche", from: "17:00" }, { name: "Almuerzo", from: "11:00" }]);
    const cost = costShifts([shift("a", "2026-11-04T15:00", "2026-11-04T19:00")], { ...settings, slot: (t) => String(turnoAt(t, turnos)) });
    expect(cost.slots.get("0")!.minutes).toBe(120);
    expect(cost.slots.get("1")!.minutes).toBe(120);
    const total = cost.slots.get("0")!.cost + cost.slots.get("1")!.cost;
    expect(total).toBeCloseTo(cost.shifts[0]!.total, 6);
  });
});

describe("turnos del local y jornada", () => {
  const turnos = sortTurnos([{ name: "Almuerzo", from: "11:00" }, { name: "Noche", from: "17:00" }]);
  it("lo de antes del primer turno cuenta para el primero; la madrugada, para el último", () => {
    expect(turnoAt(at("2026-11-04T10:30"), turnos)).toBe(0);
    expect(turnoAt(at("2026-11-04T16:59"), turnos)).toBe(0);
    expect(turnoAt(at("2026-11-04T17:00"), turnos)).toBe(1);
    expect(turnoAt(at("2026-11-05T01:00"), turnos)).toBe(1);
    expect(turnoAt(at("2026-11-05T05:00"), turnos)).toBe(0);
  });

  it("jornada y semana", () => {
    expect(jornadaOf(at("2026-11-07T03:00"))).toBe("2026-11-06");
    expect(weekOf("2026-11-08")).toBe("2026-11-02");
    expect(fmtHours(450)).toBe("7 h 30 min");
  });
});

describe("alertas", () => {
  const names = new Map([["ana", "Ana"]]);
  it("avisa al pasar de 42 horas, por más de 2 horas extra en un día y por domingos", () => {
    const list = [
      shift("1", "2026-11-09T10:00", "2026-11-09T22:30"),
      ...["10", "11", "12", "13"].map((d) => shift(d, `2026-11-${d}T10:00`, `2026-11-${d}T18:00`)),
      shift("15", "2026-11-15T10:00", "2026-11-15T18:00"),
    ];
    const cost = costShifts(list, settings);
    const texts = laborAlerts(cost, { names, from: "2026-11-09", to: "2026-11-15", today: "2026-11-15" }).map((a) => a.text);
    expect(texts).toContain("Ana lleva 52 h 30 min esta semana: pasó de las 42 h (10 h 30 min extra).");
    expect(texts.some((t) => t.includes("lunes 9 de nov.") && t.includes("3 h 30 min más de las 9 h del día"))).toBe(true);
    // El domingo es extra por la semana, no por el día: no se reporta como día largo
    expect(texts.some((t) => t.includes("el domingo 15 de nov.") && t.includes("más de las 9 h"))).toBe(false);
    expect(texts.some((t) => t.startsWith("domingo 15 de nov.: trabajaron Ana. Recargo del 90 %"))).toBe(true);
  });

  it("avisa que alguien en turno va a pasar de 42 horas, y repasa las semanas anteriores", () => {
    const list = [
      ...["02", "03", "04", "05", "06", "07"].map((d) => shift(`a${d}`, `2026-11-${d}T10:00`, `2026-11-${d}T18:00`)),
      ...["09", "10", "11", "12"].map((d) => shift(d, `2026-11-${d}T10:00`, `2026-11-${d}T18:00`)),
      shift("13", "2026-11-13T10:00", null),
    ];
    const cost = costShifts(list, { ...settings, now: new Date(at("2026-11-13T16:00")) });
    const texts = laborAlerts(cost, { names, from: "2026-11-06", to: "2026-11-13", today: "2026-11-13" }).map((a) => a.text);
    expect(texts).toContain("Ana lleva 38 h esta semana y sigue en turno: en 4 h pasa de las 42 h.");
    expect(texts).toContain("Ana trabajó 48 h la semana del 2 de nov. (6 h extra).");
  });

  it("al llegar justo a 42 horas en turno no dice «en 0 min»", () => {
    const list = [...["09", "10", "11", "12", "13"].map((d) => shift(d, `2026-11-${d}T10:00`, `2026-11-${d}T18:00`)), shift("14", "2026-11-14T10:00", null)];
    const cost = costShifts(list, { ...settings, now: new Date(at("2026-11-14T12:00")) });
    const texts = laborAlerts(cost, { names, from: "2026-11-14", to: "2026-11-14", today: "2026-11-14" }).map((a) => a.text);
    expect(texts).toContain("Ana lleva 42 h esta semana: llegó a las 42 h y sigue en turno.");
  });
});
