import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { ExchangeService } from './exchange.service';
import {
  canStartDrawing,
  DrawingPair,
  ExchangeSection,
  exchangeParticipants,
  Family,
  FamilyMember,
  generateDrawing,
  GiftExchange,
  isFamilyStepComplete,
  isRulesStepComplete,
  RelationshipType,
} from './exchange.model';

@Component({
  imports: [FormsModule, RouterLink],
  selector: 'app-exchange-page',
  styleUrl: './exchange-page.css',
  templateUrl: './exchange-page.html',
})
export class ExchangePage {
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly exchanges = inject(ExchangeService);
  private readonly routeParams = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  readonly steps: Array<{ id: ExchangeSection; number: string; label: string }> = [
    { id: 'families', number: '1', label: 'Families' },
    { id: 'rules', number: '2', label: 'Rules' },
    { id: 'drawing', number: '3', label: 'Drawing' },
  ];

  readonly section = computed(() => this.routeParams().get('section') as ExchangeSection);
  readonly exchange = computed(() => {
    const userId = this.auth.user()?.uid;
    const exchangeId = this.routeParams().get('exchangeId');
    return userId && exchangeId ? this.exchanges.getLoaded(userId, exchangeId) : undefined;
  });
  readonly familiesComplete = computed(() => {
    const exchange = this.exchange();
    return exchange ? isFamilyStepComplete(exchange) : false;
  });
  readonly rulesComplete = computed(() => {
    const exchange = this.exchange();
    return exchange ? isRulesStepComplete(exchange) : false;
  });
  readonly drawingAvailable = computed(() => {
    const exchange = this.exchange();
    return exchange ? canStartDrawing(exchange) : false;
  });
  readonly drawingRoster = computed(
    () =>
      this.exchange()?.families.flatMap((family) =>
        family.members.map((member) => ({ id: member.id, name: member.firstName })),
      ) ?? [],
  );
  readonly drawingRunKey = computed(() => {
    const exchange = this.exchange();
    return this.section() === 'drawing' && exchange
      ? `${exchange.id}:${this.drawingRoster()
          .map((member) => member.id)
          .join(',')}`
      : null;
  });
  readonly currentRulesCanDraw = computed(() => {
    const exchange = this.exchange();
    return exchange
      ? canStartDrawing({
          ...exchange,
          avoidParentChild: this.avoidParentChild(),
          avoidChildParent: this.avoidChildParent(),
          avoidSiblings: this.avoidSiblings(),
          avoidSpouses: this.avoidSpouses(),
          rulesConfigured: true,
          rulesSkipped: false,
        })
      : false;
  });
  readonly participantCount = computed(() => {
    const exchange = this.exchange();
    return exchange ? exchangeParticipants(exchange).length : 0;
  });
  readonly errorMessage = signal<string | null>(null);
  readonly drawingOrder = signal<Array<{ id: string; name: string }>>([]);
  readonly isShufflingNames = signal(false);
  readonly nameDrawStarted = signal(false);
  readonly nameDrawFinished = signal(false);
  readonly currentGiverIndex = signal(0);
  readonly nameDrawAssignments = signal<DrawingPair[]>([]);
  readonly nameDrawMessage = signal<string | null>(null);
  private readonly shuffleRestart = signal(0);
  readonly relationshipSaving = signal(false);
  readonly relationshipSaved = signal(false);
  readonly selectedMemberId = signal<string | null>(null);
  readonly dropTarget = signal<RelationshipType | null>(null);
  readonly selectedMember = computed(() => {
    const members =
      this.exchange()?.families.flatMap((family) =>
        family.members.map((member) => ({ ...member, familyName: family.name })),
      ) ?? [];
    return members.find((member) => member.id === this.selectedMemberId()) ?? members[0] ?? null;
  });

  familyName = '';
  familyMembers = '';
  readonly avoidParentChild = signal(true);
  readonly avoidChildParent = signal(true);
  readonly avoidSiblings = signal(true);
  readonly avoidSpouses = signal(true);
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private plannedAssignments: DrawingPair[] = [];

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
      }
    });
    effect((onCleanup) => {
      this.shuffleRestart();
      if (!this.drawingRunKey()) {
        if (this.retryTimer) {
          clearTimeout(this.retryTimer);
          this.retryTimer = null;
        }
        this.isShufflingNames.set(false);
        this.drawingOrder.set([]);
        this.nameDrawStarted.set(false);
        this.nameDrawFinished.set(false);
        this.currentGiverIndex.set(0);
        this.plannedAssignments = [];
        this.nameDrawAssignments.set([]);
        this.nameDrawMessage.set(null);
        return;
      }

      const roster = untracked(this.drawingRoster);
      this.isShufflingNames.set(true);
      this.drawingOrder.set(shuffleMembers(roster));

      const interval = setInterval(() => {
        this.drawingOrder.set(shuffleMembers(roster));
      }, 160);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        this.drawingOrder.set(shuffleMembers(roster));
        this.isShufflingNames.set(false);
      }, 5000);

      onCleanup(() => {
        clearInterval(interval);
        clearTimeout(timeout);
      });
    });
    effect(() => {
      const exchange = this.exchange();
      if (exchange) {
        this.avoidParentChild.set(exchange.avoidParentChild);
        this.avoidChildParent.set(exchange.avoidChildParent);
        this.avoidSiblings.set(exchange.avoidSiblings);
        this.avoidSpouses.set(exchange.avoidSpouses);
      }
    });
  }

  async addFamily(): Promise<void> {
    const exchange = this.requireExchange();
    const userId = this.auth.user()?.uid;
    if (!userId) {
      return;
    }

    this.errorMessage.set(null);
    try {
      await this.exchanges.addFamily(
        userId,
        exchange.id,
        this.familyName,
        this.familyMembers.split(/[\n,]+/),
      );
      this.familyName = '';
      this.familyMembers = '';
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not add this family.');
    }
  }

  async removeFamily(family: Family): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.exchanges.removeFamily(userId, exchange.id, family.id);
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Could not remove this family.',
      );
    }
  }

  async confirmMembers(): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    if (this.participantCount() < 2) {
      this.errorMessage.set('Add at least 2 family members before continuing.');
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.exchanges.confirmMembers(userId, exchange.id);
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Could not save the family members.',
      );
    }
  }

  async editMembers(): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.exchanges.editMembers(userId, exchange.id);
    } catch (error) {
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Could not reopen the family member list.',
      );
    }
  }

  relationshipOptions() {
    const exchange = this.exchange();
    return (
      exchange?.families.flatMap((family) =>
        family.members.map((member) => ({
          id: member.id,
          label: member.firstName,
        })),
      ) ?? []
    );
  }

  selectMember(memberId: string): void {
    this.selectedMemberId.set(memberId);
  }

  async addRelationship(relationship: RelationshipType, memberId: string): Promise<void> {
    if (this.relationshipSaving()) {
      return;
    }
    const activeMember = this.selectedMember();
    if (!activeMember || !memberId || memberId === activeMember.id) {
      return;
    }

    const existingIds =
      relationship === 'children'
        ? activeMember.relationships.childrenIds
        : relationship === 'siblings'
          ? activeMember.relationships.siblingIds
          : activeMember.relationships.spouseId
            ? [activeMember.relationships.spouseId]
            : [];
    const updatedIds =
      relationship === 'spouse'
        ? [memberId]
        : existingIds.includes(memberId)
          ? existingIds
          : [...existingIds, memberId];
    await this.persistRelationship(activeMember.id, relationship, updatedIds);
  }

  async removeRelationship(relationship: RelationshipType, memberId: string): Promise<void> {
    if (this.relationshipSaving()) {
      return;
    }
    const activeMember = this.selectedMember();
    if (!activeMember) {
      return;
    }
    const existingIds =
      relationship === 'children'
        ? activeMember.relationships.childrenIds
        : relationship === 'siblings'
          ? activeMember.relationships.siblingIds
          : activeMember.relationships.spouseId
            ? [activeMember.relationships.spouseId]
            : [];
    const updatedIds = relationship === 'spouse' ? [] : existingIds.filter((id) => id !== memberId);
    await this.persistRelationship(activeMember.id, relationship, updatedIds);
  }

  allowDrop(event: DragEvent, relationship: RelationshipType): void {
    event.preventDefault();
    this.dropTarget.set(relationship);
  }

  clearDropTarget(): void {
    this.dropTarget.set(null);
  }

  async dropRelationship(event: DragEvent, relationship: RelationshipType): Promise<void> {
    event.preventDefault();
    const memberId = event.dataTransfer?.getData('text/plain');
    this.dropTarget.set(null);
    if (memberId) {
      await this.addRelationship(relationship, memberId);
    }
  }

  startMemberDrag(event: DragEvent, memberId: string): void {
    event.dataTransfer?.setData('text/plain', memberId);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  memberName(memberId: string): string {
    return this.relationshipOptions().find((member) => member.id === memberId)?.label ?? '';
  }

  private async persistRelationship(
    memberId: string,
    relationship: RelationshipType,
    memberIds: string[],
  ): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }

    this.errorMessage.set(null);
    this.relationshipSaved.set(false);
    this.relationshipSaving.set(true);
    try {
      await this.exchanges.setRelationship(userId, exchange.id, memberId, relationship, memberIds);
      this.relationshipSaved.set(true);
    } catch (error) {
      const saveError =
        error instanceof Error ? error.message : 'Could not save this relationship.';
      try {
        await this.exchanges.load(userId);
        this.errorMessage.set(saveError);
      } catch (reloadError) {
        const reloadMessage =
          reloadError instanceof Error ? reloadError.message : 'Could not reload saved data.';
        this.errorMessage.set(
          `${saveError} The saved selection could not be reloaded: ${reloadMessage}`,
        );
      }
    } finally {
      this.relationshipSaving.set(false);
    }
  }

  async saveRules(): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.exchanges.saveRules(
        userId,
        exchange.id,
        this.avoidParentChild(),
        this.avoidChildParent(),
        this.avoidSiblings(),
        this.avoidSpouses(),
      );
      if (!canStartDrawing(this.requireExchange())) {
        this.errorMessage.set(
          'These rules cannot make a valid draw with the current relationships. Add participants or adjust the rules.',
        );
        return;
      }
      if (!(await this.navigateTo('drawing'))) {
        this.errorMessage.set('Could not open the Drawing step. Please try again.');
      }
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not save rules.');
    }
  }

  async skipRules(): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    this.errorMessage.set(null);
    try {
      await this.exchanges.skipRules(userId, exchange.id);
      if (!(await this.navigateTo('drawing'))) {
        this.errorMessage.set('Could not open the Drawing step. Please try again.');
      }
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not skip rules.');
    }
  }

  stepStatus(step: ExchangeSection): string {
    const exchange = this.exchange();
    if (!exchange) {
      return 'Unavailable';
    }

    if (step === 'families') {
      return this.familiesComplete() ? 'Complete' : 'In progress';
    }
    if (step === 'rules') {
      return this.rulesComplete()
        ? exchange.rulesSkipped
          ? 'Skipped'
          : 'Complete'
        : 'Not started';
    }
    return exchange.drawing ? 'Complete' : 'Not started';
  }

  sectionTitle(): string {
    switch (this.section()) {
      case 'families':
        return 'Families';
      case 'rules':
        return 'Rules';
      case 'drawing':
        return 'Drawing';
    }
  }

  trackFamily(_index: number, family: Family): string {
    return family.id;
  }

  trackMember(_index: number, member: FamilyMember): string {
    return member.id;
  }

  familyMembersLabel(family: Family): string {
    return family.members.map((member) => member.firstName).join(', ');
  }

  startNameDraw(): void {
    if (this.isShufflingNames() || this.nameDrawStarted() || !this.drawingOrder().length) {
      return;
    }

    const drawing = generateDrawing(this.requireExchange());
    if (!drawing) {
      this.nameDrawStarted.set(true);
      this.nameDrawMessage.set(
        'No complete valid drawing is possible with the current relationships and rules. Adjust them and try again.',
      );
      return;
    }
    const assignmentsByGiver = new Map(drawing.map((pair) => [pair.giverId, pair]));
    this.plannedAssignments = this.drawingOrder()
      .map((member) => assignmentsByGiver.get(member.id))
      .filter((pair): pair is DrawingPair => pair !== undefined);
    if (this.plannedAssignments.length !== this.drawingOrder().length) {
      this.plannedAssignments = [];
      this.nameDrawStarted.set(true);
      this.nameDrawMessage.set('Could not match every family member in the drawing order.');
      return;
    }

    this.nameDrawStarted.set(true);
    this.currentGiverIndex.set(0);
    this.nameDrawFinished.set(false);
    this.nameDrawAssignments.set([]);
    this.revealNextAssignment();
  }

  printDrawing(): void {
    window.print();
  }

  startOver(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.nameDrawStarted.set(false);
    this.nameDrawFinished.set(false);
    this.currentGiverIndex.set(0);
    this.plannedAssignments = [];
    this.nameDrawAssignments.set([]);
    this.nameDrawMessage.set(null);
    this.shuffleRestart.update((restart) => restart + 1);
  }

  currentGiverName(): string {
    return this.drawingOrder()[this.currentGiverIndex()]?.name ?? '';
  }

  private revealNextAssignment(): void {
    const assignment = this.plannedAssignments[this.currentGiverIndex()];
    if (!assignment) {
      this.nameDrawFinished.set(true);
      this.nameDrawMessage.set('Everyone has drawn a name.');
      return;
    }

    this.nameDrawAssignments.update((assignments) => [...assignments, assignment]);
    if (this.nameDrawAssignments().length === this.drawingOrder().length) {
      this.nameDrawFinished.set(true);
      this.nameDrawMessage.set('Everyone has drawn a name.');
      return;
    }
    this.nameDrawMessage.set(`${assignment.giver} is giving a gift to ${assignment.recipient}.`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.nameDrawMessage.set(null);
      this.currentGiverIndex.update((index) => index + 1);
      this.revealNextAssignment();
    }, 800);
  }

  private requireExchange(): GiftExchange {
    const exchange = this.exchange();
    if (!exchange) {
      throw new Error('This gift exchange could not be found.');
    }
    return exchange;
  }

  private async navigateTo(section: ExchangeSection): Promise<boolean> {
    const exchange = this.requireExchange();
    return this.router.navigate(['/exchanges', exchange.id, section]);
  }
}

function shuffleMembers<T>(members: T[]): T[] {
  const shuffled = members.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swapIndex = randomIndex(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function randomIndex(maxExclusive: number): number {
  const values = new Uint32Array(1);
  const maxValue = 0x100000000;
  const limit = maxValue - (maxValue % maxExclusive);
  do {
    globalThis.crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return values[0] % maxExclusive;
}
