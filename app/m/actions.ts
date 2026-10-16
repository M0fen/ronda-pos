"use server";

import { safely } from "@/lib/server/errors";
import type { ChosenItem } from "@/lib/server/menu";
import { clientCheck, reportClientPayment, simpleQrRequest, submitQrOrder } from "@/lib/server/qr";

export async function qrOrderAction(token: string, items: ChosenItem[], guestName: string) {
  return safely(() => submitQrOrder(String(token), Array.isArray(items) ? items : [], String(guestName ?? "")));
}

export async function qrCallAction(token: string, kind: "waiter" | "bill") {
  return safely(() => simpleQrRequest(String(token), kind === "bill" ? "bill" : "waiter"));
}

export async function qrPayAction(token: string, input: { method: string; amount: number; tip: number; reference: string; part: string }) {
  return safely(() => reportClientPayment(String(token), input));
}

export async function qrCheckAction(token: string) {
  return clientCheck(String(token));
}
