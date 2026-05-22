import { z } from 'zod';

export const couponSchema = z.object({
  code: z.string(),
  discount: z.number(),
  active: z.boolean(),
});

export const deliverSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
});

export const orderSchema = z.object({
  id: z.string(),
  total: z.number(),
  status: z.string(),
  createdAt: z.any(),
});

export const productSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  image: z.string(),
});

export const tokenSchema = z.object({
  token: z.string(),
  userId: z.string(),
});

export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.string(),
});

export const db = {} as any;
export const collection = (() => ({})) as any;
export const doc = (() => ({})) as any;
export const setDoc = (async () => ({})) as any;
export const getDoc = (async () => ({ exists: () => false, data: () => ({}) })) as any;
export const updateDoc = (async () => ({})) as any;
export const deleteDoc = (async () => ({})) as any;
export const query = (() => ({})) as any;
export const where = (() => ({})) as any;
export const getDocs = (async () => ({ docs: [] })) as any;
export function writeLog(..._args: any[]) {}
export async function getProduct(..._args: any[]) { return null; }
export async function createOrder(..._args: any[]) { return 'order-id'; }
export async function getProducts(..._args: any[]) { return []; }
export async function getOrders(..._args: any[]) { return []; }
export async function getUsers(..._args: any[]) { return []; }
export async function getLeads(..._args: any[]) { return []; }
export async function getCoupon(..._args: any[]) { return null; }
export async function saveSiteConfig(..._args: any[]) {}
export async function getSiteConfig(..._args: any[]) { return null; }
export async function markOrderPaid(..._args: any[]) {}
export async function incrementCouponUsage(..._args: any[]) {}
export async function updateUser(..._args: any[]) {}
export async function getUser(..._args: any[]) { return null; }
export async function createUser(..._args: any[]) {}
export async function adminUpdateProduct(..._args: any[]) {}
export async function updateReadingProgress(..._args: any[]) {}
export async function hasBookAccess(..._args: any[]) { return false; }