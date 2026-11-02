/** One thing a key may be allowed to read. */
export type KeyScope = { id: string; name: string; about: string; default: boolean };

/** A key as listed: never the key itself. */
export type ApiKey = {
  id: string;
  name: string;
  /** Its first characters, to tell keys apart. */
  prefix: string;
  scopes: string[];
  /** Unix seconds. */
  created_at: number;
  last_used: number | null;
};

export type KeysResponse = { keys: ApiKey[]; scopes: KeyScope[] };

/** A key just made: the whole key is here once and never again. */
export type NewKey = ApiKey & { key: string };
