"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { STORE_COOKIE } from "./context";

/** Remember the selected store for this browser (the database still checks access on every call). */
export async function selectStore(storeId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(storeId)) return;
  (await cookies()).set(STORE_COOKIE, storeId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
