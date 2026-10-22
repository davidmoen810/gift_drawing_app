import { Injectable, signal } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';
import { Family, FamilyMember, GiftExchange, RelationshipType } from './exchange.model';

interface StoredExchange extends GiftExchange {
  ownerId: string;
}

interface GiftDrawingDatabase extends DBSchema {
  exchanges: {
    key: string;
    value: StoredExchange;
    indexes: { 'by-owner': string };
  };
}

@Injectable({ providedIn: 'root' })
export class ExchangeService {
  private readonly state = signal<{ userId: string | null; exchanges: GiftExchange[] }>({
    userId: null,
    exchanges: [],
  });
  private readonly loads = new Map<string, Promise<GiftExchange[]>>();
  private databasePromise: Promise<IDBPDatabase<GiftDrawingDatabase>> | null = null;

  async load(userId: string): Promise<void> {
    this.state.set({ userId, exchanges: await this.getForUser(userId) });
  }

  listLoaded(userId: string): GiftExchange[] {
    const state = this.state();
    return state.userId === userId ? state.exchanges : [];
  }

  getLoaded(userId: string, exchangeId: string): GiftExchange | undefined {
    return this.listLoaded(userId).find((exchange) => exchange.id === exchangeId);
  }

  async create(userId: string, name: string): Promise<GiftExchange> {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error('Enter a name for the gift exchange.');
    }
    await this.load(userId);
    const existingExchanges = this.listLoaded(userId);
    const exchange: GiftExchange = {
      id: globalThis.crypto.randomUUID(),
      name: cleanName,
      families: [],
      membersConfirmed: false,
      avoidParentChild: true,
      avoidChildParent: true,
      avoidSiblings: true,
      avoidSpouses: true,
      rulesConfigured: false,
      rulesSkipped: false,
      drawing: null,
      createdAt: Date.now(),
    };

    const database = await this.database();
    await database.put('exchanges', { ...exchange, ownerId: userId });
    await this.refresh(userId, [...existingExchanges, exchange]);
    return exchange;
  }

  async addFamily(
    userId: string,
    exchangeId: string,
    name: string,
    memberNames: string[],
  ): Promise<void> {
    const cleanName = name.trim();
    const names = memberNames.map((member) => member.trim()).filter(Boolean);
    if (!cleanName) {
      throw new Error('Enter a family name.');
    }
    if (!names.length) {
      throw new Error('Add at least one person to this family.');
    }

    await this.update(userId, exchangeId, (exchange) => {
      const family: Family = {
        id: globalThis.crypto.randomUUID(),
        name: cleanName,
        members: names.map(createMember),
      };
      return {
        ...exchange,
        families: [...exchange.families, family],
        membersConfirmed: false,
        drawing: null,
      };
    });
  }

  async removeFamily(userId: string, exchangeId: string, familyId: string): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => {
      const removedIds = new Set(
        exchange.families
          .find((family) => family.id === familyId)
          ?.members.map((member) => member.id) ?? [],
      );
      return {
        ...exchange,
        families: exchange.families
          .filter((family) => family.id !== familyId)
          .map((family) => ({
            ...family,
            members: family.members.map((member) => ({
              ...member,
              relationships: clearRelationshipsTo(member.relationships, removedIds),
            })),
          })),
        membersConfirmed: false,
        drawing: null,
      };
    });
  }

  async confirmMembers(userId: string, exchangeId: string): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => {
      if (exchange.families.reduce((total, family) => total + family.members.length, 0) < 2) {
        throw new Error('Add at least 2 family members before continuing.');
      }
      return { ...exchange, membersConfirmed: true, drawing: null };
    });
  }

  async editMembers(userId: string, exchangeId: string): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => ({
      ...exchange,
      membersConfirmed: false,
      drawing: null,
    }));
  }

  async setRelationship(
    userId: string,
    exchangeId: string,
    memberId: string,
    relationship: RelationshipType,
    relatedMembers: string[] | string | null,
  ): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => {
      const members = exchange.families.flatMap((family) => family.members);
      const member = members.find((candidate) => candidate.id === memberId);
      if (!member) {
        throw new Error('This family member could not be found.');
      }
      const relatedMemberIds =
        relationship === 'spouse'
          ? typeof relatedMembers === 'string'
            ? relatedMembers
              ? [relatedMembers]
              : []
            : Array.isArray(relatedMembers)
              ? relatedMembers
              : []
          : Array.isArray(relatedMembers)
            ? relatedMembers
            : relatedMembers
              ? [relatedMembers]
              : [];
      if (
        relatedMemberIds.some(
          (id) => !members.some((candidate) => candidate.id === id) || id === memberId,
        ) ||
        new Set(relatedMemberIds).size !== relatedMemberIds.length ||
        (relationship === 'spouse' && relatedMemberIds.length > 1)
      ) {
        throw new Error('Choose a different family member or None.');
      }

      const selection =
        relationship === 'spouse' ? (relatedMemberIds[0] ?? null) : relatedMemberIds;
      return {
        ...exchange,
        families: exchange.families.map((family) => ({
          ...family,
          members: family.members.map((candidate) =>
            candidate.id === memberId
              ? {
                  ...candidate,
                  relationships: {
                    ...candidate.relationships,
                    [relationshipKey(relationship)]: selection,
                  },
                }
              : candidate,
          ),
        })),
        drawing: null,
      };
    });
  }

  async saveRules(
    userId: string,
    exchangeId: string,
    avoidParentChild: boolean,
    avoidChildParent: boolean,
    avoidSiblings: boolean,
    avoidSpouses: boolean,
  ): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => ({
      ...exchange,
      avoidParentChild,
      avoidChildParent,
      avoidSiblings,
      avoidSpouses,
      rulesConfigured: true,
      rulesSkipped: false,
      drawing: null,
    }));
  }

  async skipRules(userId: string, exchangeId: string): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => ({
      ...exchange,
      avoidParentChild: true,
      avoidChildParent: true,
      avoidSiblings: true,
      avoidSpouses: true,
      rulesConfigured: false,
      rulesSkipped: true,
      drawing: null,
    }));
  }

  async saveDrawing(
    userId: string,
    exchangeId: string,
    drawing: GiftExchange['drawing'],
  ): Promise<void> {
    await this.update(userId, exchangeId, (exchange) => ({ ...exchange, drawing }));
  }

  private async getForUser(userId: string): Promise<GiftExchange[]> {
    const existingLoad = this.loads.get(userId);
    if (existingLoad) {
      return existingLoad;
    }

    const load = this.loadFromDatabase(userId);
    this.loads.set(userId, load);
    try {
      return await load;
    } finally {
      if (this.loads.get(userId) === load) {
        this.loads.delete(userId);
      }
    }
  }

  private async loadFromDatabase(userId: string): Promise<GiftExchange[]> {
    const database = await this.database();
    const records = await database.getAllFromIndex('exchanges', 'by-owner', userId);
    const normalizedRecords = records.map(normalizeExchange);
    const legacyKey = `gift-drawing-exchanges:${userId}`;
    const serialized = localStorage.getItem(legacyKey);
    let legacyExchanges: GiftExchange[] = [];
    if (serialized) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(serialized);
      } catch {
        throw new Error(
          'Saved exchanges could not be migrated from browser storage because the saved data is invalid.',
        );
      }
      if (!Array.isArray(parsed)) {
        throw new Error('Saved exchanges could not be migrated from browser storage.');
      }
      legacyExchanges = parsed.map(normalizeExchange);
    }

    const existingIds = new Set(normalizedRecords.map((exchange) => exchange.id));
    const merged = [
      ...normalizedRecords,
      ...legacyExchanges.filter((exchange) => !existingIds.has(exchange.id)),
    ];
    const normalizedById = new Map(merged.map((exchange) => [exchange.id, exchange]));
    const transaction = database.transaction('exchanges', 'readwrite');
    for (const record of records) {
      const normalized = normalizedById.get(record.id)!;
      if (JSON.stringify(record) !== JSON.stringify({ ...normalized, ownerId: userId })) {
        await transaction.store.put({ ...normalized, ownerId: userId });
      }
    }
    for (const exchange of legacyExchanges) {
      if (!existingIds.has(exchange.id)) {
        await transaction.store.put({ ...exchange, ownerId: userId });
      }
    }
    await transaction.done;
    if (serialized) {
      localStorage.removeItem(legacyKey);
    }
    return merged;
  }

  private async update(
    userId: string,
    exchangeId: string,
    transform: (exchange: GiftExchange) => GiftExchange,
  ): Promise<void> {
    await this.load(userId);
    const database = await this.database();
    const transaction = database.transaction('exchanges', 'readwrite');
    const record = await transaction.store.get(exchangeId);
    if (!record || record.ownerId !== userId) {
      transaction.abort();
      throw new Error('This gift exchange could not be found.');
    }

    const { ownerId: _ownerId, ...exchange } = record;
    const updated = transform(normalizeExchange(exchange));
    await transaction.store.put({ ...updated, ownerId: userId });
    await transaction.done;
    await this.refresh(userId);
  }

  private async refresh(userId: string, exchanges?: GiftExchange[]): Promise<void> {
    const updated = exchanges ?? (await this.readFromDatabase(userId));
    if (this.state().userId === userId) {
      this.state.set({ userId, exchanges: updated });
    }
  }

  private async readFromDatabase(userId: string): Promise<GiftExchange[]> {
    const database = await this.database();
    return (await database.getAllFromIndex('exchanges', 'by-owner', userId)).map(normalizeExchange);
  }

  private database(): Promise<IDBPDatabase<GiftDrawingDatabase>> {
    this.databasePromise ??= openDB<GiftDrawingDatabase>('gift-drawing', 1, {
      upgrade(database) {
        const store = database.createObjectStore('exchanges', { keyPath: 'id' });
        store.createIndex('by-owner', 'ownerId');
      },
    });
    return this.databasePromise;
  }
}

function createMember(firstName: string): FamilyMember {
  return {
    id: globalThis.crypto.randomUUID(),
    firstName,
    relationships: { childrenIds: [], siblingIds: [], spouseId: null },
  };
}

function relationshipKey(
  relationship: RelationshipType,
): 'childrenIds' | 'siblingIds' | 'spouseId' {
  switch (relationship) {
    case 'children':
      return 'childrenIds';
    case 'siblings':
      return 'siblingIds';
    case 'spouse':
      return 'spouseId';
  }
}

function clearRelationshipsTo(
  relationships: FamilyMember['relationships'],
  removedMemberIds: Set<string>,
): FamilyMember['relationships'] {
  return {
    childrenIds: relationships.childrenIds.filter((id) => !removedMemberIds.has(id)),
    siblingIds: relationships.siblingIds.filter((id) => !removedMemberIds.has(id)),
    spouseId:
      relationships.spouseId && removedMemberIds.has(relationships.spouseId)
        ? null
        : relationships.spouseId,
  };
}

function normalizeExchange(record: StoredExchange | GiftExchange): GiftExchange {
  const raw = record as GiftExchange & { ownerId?: string };
  const legacyParentLinks: Array<{ childId: string; parentId: string }> = [];
  const families = Array.isArray(raw.families)
    ? raw.families.map((family) => ({
        ...family,
        members: Array.isArray(family.members)
          ? family.members.map((storedMember) => {
              if (typeof storedMember === 'string') {
                return createMember(storedMember);
              }
              const legacyRelationships = (
                storedMember as FamilyMember & {
                  relationships: FamilyMember['relationships'] & {
                    parentId?: string | null;
                    siblingId?: string | null;
                  };
                }
              ).relationships;
              const member: FamilyMember = {
                id: storedMember.id || globalThis.crypto.randomUUID(),
                firstName: storedMember.firstName ?? '',
                relationships: {
                  childrenIds: Array.isArray(legacyRelationships?.childrenIds)
                    ? legacyRelationships.childrenIds
                    : [],
                  siblingIds: Array.isArray(legacyRelationships?.siblingIds)
                    ? legacyRelationships.siblingIds
                    : typeof legacyRelationships?.siblingId === 'string'
                      ? [legacyRelationships.siblingId]
                      : [],
                  spouseId: legacyRelationships?.spouseId ?? null,
                },
              };
              if (legacyRelationships?.parentId) {
                legacyParentLinks.push({
                  childId: member.id,
                  parentId: legacyRelationships.parentId,
                });
              }
              return member;
            })
          : [],
      }))
    : [];
  const participants = families.flatMap((family) => family.members);
  const participantIds = new Set(participants.map((member) => member.id));
  for (const { childId, parentId } of legacyParentLinks) {
    if (participantIds.has(parentId)) {
      const parent = participants.find((candidate) => candidate.id === parentId);
      if (parent && !parent.relationships.childrenIds.includes(childId)) {
        parent.relationships.childrenIds.push(childId);
      }
    }
  }
  const normalizedFamilies = families.map((family) => ({
    ...family,
    members: family.members.map((member) => ({
      ...member,
      relationships: {
        childrenIds: member.relationships.childrenIds.filter((id) => participantIds.has(id)),
        siblingIds: member.relationships.siblingIds.filter((id) => participantIds.has(id)),
        spouseId:
          member.relationships.spouseId && participantIds.has(member.relationships.spouseId)
            ? member.relationships.spouseId
            : null,
      },
    })),
  }));
  const count = participants.length;
  const drawing = Array.isArray(raw.drawing)
    ? raw.drawing.map((pair) => ({
        giverId: 'giverId' in pair ? pair.giverId : '',
        giver: pair.giver,
        recipientId: 'recipientId' in pair ? pair.recipientId : '',
        recipient: pair.recipient,
      }))
    : null;

  return {
    id: raw.id,
    name: raw.name,
    families: normalizedFamilies,
    membersConfirmed: typeof raw.membersConfirmed === 'boolean' ? raw.membersConfirmed : count >= 2,
    avoidParentChild: raw.avoidParentChild ?? true,
    avoidChildParent: raw.avoidChildParent ?? true,
    avoidSiblings: raw.avoidSiblings ?? true,
    avoidSpouses: raw.avoidSpouses ?? true,
    rulesConfigured: raw.rulesConfigured ?? false,
    rulesSkipped: raw.rulesSkipped ?? false,
    drawing,
    createdAt: raw.createdAt,
  };
}
