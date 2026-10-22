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
  avoidParentChild: boolean;
  avoidChildParent: boolean;
  avoidSiblings: boolean;
  avoidSpouses: boolean;
  rulesConfigured: boolean;
  rulesSkipped: boolean;
  drawing: DrawingPair[] | null;
  createdAt: number;
}

export function exchangeParticipants(exchange: GiftExchange): Array<{
  id: string;
  name: string;
  familyId: string;
  childrenIds: string[];
  siblingIds: string[];
  spouseId: string | null;
}> {
  return exchange.families.flatMap((family) =>
    family.members.map((member) => ({
      id: member.id,
      name: member.firstName,
      familyId: family.id,
      childrenIds: member.relationships.childrenIds,
      siblingIds: member.relationships.siblingIds,
      spouseId: member.relationships.spouseId,
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
  const matchedGivers = new Map<string, string>();

  function canMatch(giverId: string, visitedRecipients: Set<string>): boolean {
    const giverParticipant = participants.find((participant) => participant.id === giverId);
    if (!giverParticipant) {
      return false;
    }
    for (const recipient of participants) {
      if (
        recipient.id === giverId ||
        visitedRecipients.has(recipient.id) ||
        (exchange.avoidParentChild && giverParticipant.childrenIds.includes(recipient.id)) ||
        (exchange.avoidChildParent && recipient.childrenIds.includes(giverId)) ||
        (exchange.avoidSiblings &&
          (giverParticipant.siblingIds.includes(recipient.id) ||
            recipient.siblingIds.includes(giverId))) ||
        (exchange.avoidSpouses &&
          (giverParticipant.spouseId === recipient.id || recipient.spouseId === giverId))
      ) {
        continue;
      }
      visitedRecipients.add(recipient.id);
      const previousGiver = matchedGivers.get(recipient.id);
      if (!previousGiver || canMatch(previousGiver, visitedRecipients)) {
        matchedGivers.set(recipient.id, giverId);
        return true;
      }
    }
    return false;
  }

  return participants.every((participant) => canMatch(participant.id, new Set()));
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
          (!exchange.avoidParentChild ||
            !participants[giverIndex].childrenIds.includes(participants[index].id)) &&
          (!exchange.avoidChildParent ||
            !participants[index].childrenIds.includes(participants[giverIndex].id)) &&
          (!exchange.avoidSiblings ||
            (!participants[giverIndex].siblingIds.includes(participants[index].id) &&
              !participants[index].siblingIds.includes(participants[giverIndex].id))) &&
          (!exchange.avoidSpouses ||
            (participants[giverIndex].spouseId !== participants[index].id &&
              participants[index].spouseId !== participants[giverIndex].id)),
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
