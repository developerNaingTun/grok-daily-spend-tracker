import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const api = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '');
export const configured = !!url && !!key && !!api;
// Chunk sessions to stay within SecureStore's per-value limits on native platforms.
const storage = {
  async getItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key + '-count') ?? 0);
    if (!count) return null;
    const chunks = await Promise.all(Array.from({length: count}, (_, i) => SecureStore.getItemAsync(`${key}-${i}`)));
    return chunks.some(c => c === null) ? null : chunks.join('');
  },
  async setItem(key: string, value: string) {
    await this.removeItem(key);
    const chunks = value.match(/[\s\S]{1,1000}/g) ?? [];
    for (let i=0; i<chunks.length; i++) await SecureStore.setItemAsync(`${key}-${i}`, chunks[i]);
    await SecureStore.setItemAsync(key + '-count', String(chunks.length));
  },
  async removeItem(key: string) {
    const count = Number(await SecureStore.getItemAsync(key + '-count') ?? 0);
    await SecureStore.deleteItemAsync(key + '-count');
    await Promise.all(Array.from({length: count}, (_, i) => SecureStore.deleteItemAsync(`${key}-${i}`)));
  }
};
export const supabase = createClient(url || 'https://unconfigured.supabase.co', key || 'unconfigured', {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false }
});
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Please sign in again.');
  const response = await fetch(`${api}/api/${path}`, { method,
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(25000) });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Session expired. Sign out and sign in again.');
    const data = await response.json().catch(() => null);
    throw new Error(data?.error ?? 'Unable to connect. Try again.');
  }
  return response.json();
}
