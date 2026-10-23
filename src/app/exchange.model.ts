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

  return findDrawingAssignment(exchange, false) !== null;
}

export function generateDrawing(exchange: GiftExchange): DrawingPair[] | null {
  if (!isFamilyStepComplete(exchange) || !isRulesStepComplete(exchange)) {
    return null;
  }

  return findDrawingAssignment(exchange, true);
}

function findDrawingAssignment(exchange: GiftExchange, randomize: boolean): DrawingPair[] | null {
  const participants = exchangeParticipants(exchange);
  if (participants.length < 2) {
    return null;
  }

  const matchedGiverByRecipient = new Array<number>(participants.length).fill(-1);
  const giverOrder = participants.map((_, index) => index);
  if (randomize) {
    shuffle(giverOrder);
  }

  function canAssign(giverIndex: number, visitedRecipients: Set<number>): boolean {
    const giver = participants[giverIndex];
    const candidates = participants
      .map((_, index) => index)
      .filter((recipientIndex) => {
        const recipient = participants[recipientIndex];
        return (
          recipientIndex !== giverIndex &&
          !visitedRecipients.has(recipientIndex) &&
          (!exchange.avoidParentChild || !giver.childrenIds.includes(recipient.id)) &&
          (!exchange.avoidChildParent || !recipient.childrenIds.includes(giver.id)) &&
          (!exchange.avoidSiblings ||
            (!giver.siblingIds.includes(recipient.id) &&
              !recipient.siblingIds.includes(giver.id))) &&
          (!exchange.avoidSpouses ||
            (giver.spouseId !== recipient.id && recipient.spouseId !== giver.id))
        );
      });
    if (randomize) {
      shuffle(candidates);
    }

    for (const recipientIndex of candidates) {
      visitedRecipients.add(recipientIndex);
      const previousGiver = matchedGiverByRecipient[recipientIndex];
      if (previousGiver === -1 || canAssign(previousGiver, visitedRecipients)) {
        matchedGiverByRecipient[recipientIndex] = giverIndex;
        return true;
      }
    }
    return false;
  }

  if (!giverOrder.every((giverIndex) => canAssign(giverIndex, new Set()))) {
    return null;
  }

  return participants.map((giver, giverIndex) => {
    const recipientIndex = matchedGiverByRecipient.indexOf(giverIndex);
    const recipient = participants[recipientIndex];
    return {
      giverId: giver.id,
      giver: giver.name,
      recipientId: recipient.id,
      recipient: recipient.name,
    };
  });
}

function shuffle<T>(items: T[]): void {
  for (let index = items.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
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
