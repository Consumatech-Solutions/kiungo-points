/** The two plugs into the rail (ADR-003, ADR-005). Stand-ins now; the real rails in T-12. */

export type Trust = 'joined' | 'vouched' | 'verified';

export interface Person {
  kiungoId: string;
  trust: Trust;
  timezone: string;
}

/** Identity plug: who a Kiungo ID is, and what they allow. */
export interface IdentityPlug {
  lookup(kiungoId: string): Promise<Person | null>;
  allows(kiungoId: string, reader: string): Promise<boolean>;
}

/** One entry in a person's activity record. A reference only: never the content. */
export interface ActivityEntry {
  entryId: string;
  kiungoId: string;
  kind: string;
  occurredAt: string;
  carriage: string;
  item?: string;     // which thing it is about, for quests paid once per item: a survey, a shop, an invited person
  evidence?: string; // a reference to its proof, such as a sale code
}

/** The name the points system reads activity under. */
export const READER = 'kiungo-points';

export const TRUST_ORDER: Trust[] = ['joined', 'vouched', 'verified'];
