/** What the backend says, without the prefix rusqlite puts on a refusal of ours. */
export const errorText = (e: unknown) => (typeof e === 'string' ? e : (e as Error)?.message ?? String(e)).replace(/^Invalid parameter: /, '');
