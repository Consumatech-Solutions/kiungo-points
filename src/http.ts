import { z } from 'zod';

export const KIUNGO_ID = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const CARRIAGE_NAME = z.string().regex(/^[a-z0-9.-]{1,64}$/);
export const UNIT = z.string().regex(/^[a-z0-9_-]{1,64}$/, 'A unit id is lower-case letters, digits, - and _.');

/** The error shape every route answers with (TRD §5). */
export const error = (code: string, message: string) => ({ error: { code, message } });

/** The key in an `Authorization: Bearer <key>` header, or ''. */
export const bearer = (h: string | undefined) => h?.match(/^Bearer (.+)$/)?.[1] ?? '';
