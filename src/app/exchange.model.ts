export type ExchangeSection = 'families' | 'rules' | 'drawing';
export type RelationshipType = 'children' | 'siblings' | 'spouse';

export interface Relationships {
  childrenIds: string[];
  siblingIds: string[];
  spouseId: string | null;
}

export interface FamilyMember {
  id: string;
  firstName: string;
  relationships: Relationships;
}

export interface Family {
  id: string;
  name: string;
  members: FamilyMember[];
}

export interface DrawingPair {
  giverId: string;
  giver: string;
  recipientId: string;
  recipient: string;
}

export interface GiftExchange {
  id: string;
  name: string;
  families: Family[];
  membersConfirmed: boolean;
  avoidSameFamily: boolean;
  rulesConfigured: boolean;
  rulesSkipped: boolean;
  drawing: DrawingPair[] | null;
  createdAt: number;
}

export function exchangeParticipants(exchange: GiftExchange): Array<{
  id: string;
  name: string;
  familyId: string;
}> {
  return exchange.families.flatMap((family) =>
    family.members.map((member) => ({
      id: member.id,
      name: member.firstName,
      familyId: family.id,
    })),
  );
}

export function isFamilyStepComplete(exchange: GiftExchange): boolean {
  return exchange.membersConfirmed && exchangeParticipants(exchange).length >= 2;
}

export function isRulesStepComplete(exchange: GiftExchange): boolean {
  return exchange.rulesConfigured || exchange.rulesSkipped;
}

export function canStartDrawing(exchange: GiftExchange): boolean {
  if (!isFamilyStepComplete(exchange) || !isRulesStepComplete(exchange)) {
    return false;
  }

  const participants = exchangeParticipants(exchange);
  if (!exchange.avoidSameFamily) {
    return true;
  }

  const familyCounts = new Map<string, number>();
  for (const participant of participants) {
    familyCounts.set(participant.familyId, (familyCounts.get(participant.familyId) ?? 0) + 1);
  }

  return Math.max(...familyCounts.values()) <= Math.floor(participants.length / 2);
}

export function generateDrawing(exchange: GiftExchange): DrawingPair[] | null {
  if (!canStartDrawing(exchange)) {
    return null;
  }

  const participants = exchangeParticipants(exchange);
  const recipients = new Set<number>();
  const pairs: DrawingPair[] = [];
  let attempts = 0;

  function assign(giverIndex: number): boolean {
    if (giverIndex === participants.length) {
      return true;
    }
    if (++attempts > 50000) {
      return false;
    }

    const candidates = participants
      .map((_, index) => index)
      .filter(
        (index) =>
          index !== giverIndex &&
          !recipients.has(index) &&
          (!exchange.avoidSameFamily ||
            participants[index].familyId !== participants[giverIndex].familyId),
      );

    for (let index = candidates.length - 1; index > 0; index--) {
      const swapIndex = randomIndex(index + 1);
      [candidates[index], candidates[swapIndex]] = [candidates[swapIndex], candidates[index]];
    }

    for (const recipientIndex of candidates) {
      recipients.add(recipientIndex);
      pairs.push({
        giverId: participants[giverIndex].id,
        giver: participants[giverIndex].name,
        recipientId: participants[recipientIndex].id,
        recipient: participants[recipientIndex].name,
      });
      if (assign(giverIndex + 1)) {
        return true;
      }
      pairs.pop();
      recipients.delete(recipientIndex);
    }

    return false;
  }

  return assign(0) ? pairs : null;
}

function randomIndex(maxExclusive: number): number {
  const values = new Uint32Array(1);
  const maxValue = 0x100000000;
  const limit = maxValue - (maxValue % maxExclusive);
  let value: number;

  do {
    globalThis.crypto.getRandomValues(values);
    value = values[0];
  } while (value >= limit);

  return value % maxExclusive;
}
