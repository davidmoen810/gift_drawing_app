import 'fake-indexeddb/auto';
import { TestBed } from '@angular/core/testing';
import { ExchangeService } from './exchange.service';
import {
  canStartDrawing,
  exchangeParticipants,
  generateDrawing,
  isFamilyStepComplete,
  isRulesStepComplete,
} from './exchange.model';

describe('ExchangeService', () => {
  let userId: string;
  let service: ExchangeService;

  beforeEach(() => {
    userId = globalThis.crypto.randomUUID();
    localStorage.removeItem(`gift-drawing-exchanges:${userId}`);
    TestBed.configureTestingModule({ providers: [ExchangeService] });
    service = TestBed.inject(ExchangeService);
  });

  it('creates exchanges and restores their saved progress for the same user', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam']);
    await service.confirmMembers(userId, exchange.id);
    await service.skipRules(userId, exchange.id);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(saved.name).toBe('Holiday exchange');
    expect(saved.families[0].members.map((member) => member.firstName)).toEqual(['Alex', 'Sam']);
    expect(saved.membersConfirmed).toBe(true);
    expect(saved.rulesSkipped).toBe(true);
    expect(saved.avoidSameFamily).toBe(false);
    expect(isFamilyStepComplete(saved)).toBe(true);
    expect(isRulesStepComplete(saved)).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ExchangeService] });
    const restoredService = TestBed.inject(ExchangeService);
    await restoredService.load(userId);
    expect(restoredService.getLoaded(userId, exchange.id)?.families[0].name).toBe('Parkers');
  });

  it('allows duplicate first names with distinct member identities', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Alex']);

    const members = service
      .getLoaded(userId, exchange.id)!
      .families.flatMap((family) => family.members);
    expect(members.map((member) => member.firstName)).toEqual(['Alex', 'Alex']);
    expect(members[0].id).not.toBe(members[1].id);
  });

  it('blocks an impossible same-family draw and allows it when rules are skipped', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Taylor']);
    await service.confirmMembers(userId, exchange.id);
    await service.saveRules(userId, exchange.id, true);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(canStartDrawing(saved)).toBe(false);
    expect(generateDrawing(saved)).toBeNull();

    await service.skipRules(userId, exchange.id);
    expect(canStartDrawing(service.getLoaded(userId, exchange.id)!)).toBe(true);
  });

  it('draws a one-to-one assignment with no self or same-family matches', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Taylor', 'Jordan']);
    await service.confirmMembers(userId, exchange.id);
    await service.saveRules(userId, exchange.id, true);

    const saved = service.getLoaded(userId, exchange.id)!;
    const drawing = generateDrawing(saved)!;
    const people = exchangeParticipants(saved).map((participant) => participant.name);
    expect(drawing).toHaveLength(4);
    expect(drawing.map((pair) => pair.giver).sort()).toEqual(people.slice().sort());
    expect(drawing.map((pair) => pair.recipient).sort()).toEqual(people.slice().sort());
    expect(drawing.every((pair) => pair.giver !== pair.recipient)).toBe(true);

    const familyByName = new Map(
      exchangeParticipants(saved).map((participant) => [participant.name, participant.familyId]),
    );
    expect(
      drawing.every((pair) => familyByName.get(pair.giver) !== familyByName.get(pair.recipient)),
    ).toBe(true);
  });

  it('persists relationships, rejects self-links, and clears removed-member references', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Jordan']);
    const families = service.getLoaded(userId, exchange.id)!.families;
    const [alex, sam] = families[0].members;
    const jordan = families[1].members[0];
    await service.setRelationship(userId, exchange.id, alex.id, 'siblings', [sam.id, jordan.id]);
    await expect(
      service.setRelationship(userId, exchange.id, alex.id, 'children', [alex.id]),
    ).rejects.toThrow('Choose a different family member or None.');
    await service.setRelationship(userId, exchange.id, alex.id, 'children', [sam.id, jordan.id]);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [ExchangeService] });
    const restoredService = TestBed.inject(ExchangeService);
    await restoredService.load(userId);
    const restored = restoredService.getLoaded(userId, exchange.id)!;
    expect(restored.families[0].members[0].relationships.siblingIds).toEqual([sam.id, jordan.id]);
    expect(restored.families[0].members[0].relationships.childrenIds).toEqual([sam.id, jordan.id]);

    await restoredService.removeFamily(userId, exchange.id, families[0].id);
    const afterRemoval = restoredService.getLoaded(userId, exchange.id)!;
    expect(afterRemoval.families).toHaveLength(1);
    expect(afterRemoval.families[0].members[0].relationships.siblingIds).toEqual([]);
  });

  it('migrates a saved parent selection into the parent member children list', async () => {
    const exchangeId = globalThis.crypto.randomUUID();
    const familyId = globalThis.crypto.randomUUID();
    const parentId = globalThis.crypto.randomUUID();
    const childId = globalThis.crypto.randomUUID();
    const legacyExchange = {
      id: exchangeId,
      name: 'Legacy relationships',
      families: [
        {
          id: familyId,
          name: 'Parkers',
          members: [
            {
              id: parentId,
              firstName: 'Alex',
              relationships: { parentId: null, siblingId: null, spouseId: null },
            },
            {
              id: childId,
              firstName: 'Sam',
              relationships: { parentId, siblingId: null, spouseId: null },
            },
          ],
        },
      ],
      membersConfirmed: true,
      avoidSameFamily: false,
      rulesConfigured: false,
      rulesSkipped: true,
      drawing: null,
      createdAt: Date.now(),
    };
    localStorage.setItem(`gift-drawing-exchanges:${userId}`, JSON.stringify([legacyExchange]));

    await service.load(userId);

    const migrated = service.getLoaded(userId, exchangeId)!;
    expect(migrated.families[0].members[0].relationships.childrenIds).toEqual([childId]);
    expect(migrated.families[0].members[1].relationships.childrenIds).toEqual([]);
  });

  it('requires at least two family members before confirming the roster', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex']);
    await expect(service.confirmMembers(userId, exchange.id)).rejects.toThrow(
      'Add at least 2 family members before continuing.',
    );
    expect(service.getLoaded(userId, exchange.id)?.membersConfirmed).toBe(false);
  });

  it('migrates existing browser-saved exchanges into IndexedDB', async () => {
    const legacyExchange = {
      id: globalThis.crypto.randomUUID(),
      name: 'Legacy exchange',
      families: [
        {
          id: globalThis.crypto.randomUUID(),
          name: 'Parkers',
          members: ['Alex', 'Sam'],
        },
      ],
      avoidSameFamily: true,
      rulesConfigured: false,
      rulesSkipped: false,
      drawing: null,
      createdAt: Date.now(),
    };
    localStorage.setItem(`gift-drawing-exchanges:${userId}`, JSON.stringify([legacyExchange]));

    await service.load(userId);

    expect(service.getLoaded(userId, legacyExchange.id)?.name).toBe('Legacy exchange');
    expect(service.getLoaded(userId, legacyExchange.id)?.membersConfirmed).toBe(true);
    expect(
      service
        .getLoaded(userId, legacyExchange.id)
        ?.families[0].members.map((member) => member.firstName),
    ).toEqual(['Alex', 'Sam']);
    expect(localStorage.getItem(`gift-drawing-exchanges:${userId}`)).toBeNull();
  });

  it('keeps exchanges isolated by Firebase user ID', async () => {
    const otherUserId = globalThis.crypto.randomUUID();
    const exchange = await service.create(userId, 'Private exchange');

    await service.load(otherUserId);
    expect(service.listLoaded(otherUserId)).toEqual([]);
    expect(service.getLoaded(otherUserId, exchange.id)).toBeUndefined();

    await service.load(userId);
    expect(service.getLoaded(userId, exchange.id)?.name).toBe('Private exchange');
  });
});
