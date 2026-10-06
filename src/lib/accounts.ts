// Institution accounts in the web app. The rules live in
// supabase/functions/_shared/accounts.ts so the edge function uses the same ones.

import { supabase } from '@/integrations/supabase/client';

export * from '../../supabase/functions/_shared/accounts';

/** Calls the `institution-accounts` edge function, turning its errors into readable messages. */
export async function callAccounts<T = { ok: true }>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('institution-accounts', { body: { action, ...body } });
  if (error) {
    // FunctionsHttpError carries the response; our function always answers { error }.
    const ctx = (error as { context?: Response }).context;
    let message = error.message;
    try { const j = await ctx?.json(); if (j?.error) message = j.error; } catch { /* not json */ }
    if (/Failed to send a request|FunctionsFetchError|404/i.test(message)) {
      message = 'Accounts service isn\'t set up yet — deploy the institution-accounts edge function.';
    }
    throw new Error(message);
  }
  return data as T;
}
