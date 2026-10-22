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
    expect(saved.avoidParentChild).toBe(true);
    expect(saved.avoidChildParent).toBe(true);
    expect(saved.avoidSiblings).toBe(true);
    expect(saved.avoidSpouses).toBe(true);
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

  it('does not restrict drawings based on family grouping', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam', 'Taylor']);
    await service.confirmMembers(userId, exchange.id);
    await service.saveRules(userId, exchange.id, false, false, false, false);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(canStartDrawing(saved)).toBe(true);
    expect(generateDrawing(saved)).toHaveLength(3);
  });

  it('draws a one-to-one assignment with no self matches', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Taylor', 'Jordan']);
    await service.confirmMembers(userId, exchange.id);
    await service.saveRules(userId, exchange.id, false, false, false, false);

    const saved = service.getLoaded(userId, exchange.id)!;
    const drawing = generateDrawing(saved)!;
    const people = exchangeParticipants(saved).map((participant) => participant.name);
    expect(drawing).toHaveLength(4);
    expect(drawing.map((pair) => pair.giver).sort()).toEqual(people.slice().sort());
    expect(drawing.map((pair) => pair.recipient).sort()).toEqual(people.slice().sort());
    expect(drawing.every((pair) => pair.giver !== pair.recipient)).toBe(true);
  });

  it('prevents parent-child, sibling, and spouse assignments in either direction', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Alex']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Sam']);
    await service.addFamily(userId, exchange.id, 'Chens', ['Taylor']);
    await service.addFamily(userId, exchange.id, 'Reeds', ['Jordan']);
    await service.addFamily(userId, exchange.id, 'Browns', ['Casey']);
    await service.confirmMembers(userId, exchange.id);
    const members = service
      .getLoaded(userId, exchange.id)!
      .families.map((family) => family.members[0]);
    const [parent, child, sibling, spouse] = members;
    await service.setRelationship(userId, exchange.id, parent.id, 'children', [child.id]);
    await service.setRelationship(userId, exchange.id, parent.id, 'siblings', [sibling.id]);
    await service.setRelationship(userId, exchange.id, parent.id, 'spouse', spouse.id);
    await service.saveRules(userId, exchange.id, true, true, true, true);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(canStartDrawing(saved)).toBe(true);
    const drawing = generateDrawing(saved)!;
    const assignments = new Set(drawing.map((pair) => `${pair.giverId}:${pair.recipientId}`));
    expect(assignments.has(`${parent.id}:${child.id}`)).toBe(false);
    expect(assignments.has(`${child.id}:${parent.id}`)).toBe(false);
    for (const relatedId of [sibling.id, spouse.id]) {
      expect(assignments.has(`${parent.id}:${relatedId}`)).toBe(false);
      expect(assignments.has(`${relatedId}:${parent.id}`)).toBe(false);
    }
  });

  it('detects when parent-child restrictions leave no possible drawing', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Parent', 'Child']);
    await service.confirmMembers(userId, exchange.id);
    const [parent, child] = service.getLoaded(userId, exchange.id)!.families[0].members;
    await service.setRelationship(userId, exchange.id, parent.id, 'children', [child.id]);
    await service.saveRules(userId, exchange.id, true, true, false, false);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(canStartDrawing(saved)).toBe(false);
    expect(generateDrawing(saved)).toBeNull();
  });

  it('allows a child to draw a parent when child-to-parent assignments are disabled', async () => {
    const exchange = await service.create(userId, 'Holiday exchange');
    await service.addFamily(userId, exchange.id, 'Parkers', ['Parent']);
    await service.addFamily(userId, exchange.id, 'Moores', ['Child']);
    await service.addFamily(userId, exchange.id, 'Chens', ['Other']);
    await service.confirmMembers(userId, exchange.id);
    const [parent, child] = service
      .getLoaded(userId, exchange.id)!
      .families.map((family) => family.members[0]);
    await service.setRelationship(userId, exchange.id, parent.id, 'children', [child.id]);
    await service.saveRules(userId, exchange.id, true, false, false, false);

    const saved = service.getLoaded(userId, exchange.id)!;
    expect(canStartDrawing(saved)).toBe(true);
    expect(
      generateDrawing(saved)?.some(
        (pair) => pair.giverId === child.id && pair.recipientId === parent.id,
      ),
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
