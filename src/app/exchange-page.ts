import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { ExchangeService } from './exchange.service';
import {
  canStartDrawing,
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
  readonly participantCount = computed(() => {
    const exchange = this.exchange();
    return exchange ? exchangeParticipants(exchange).length : 0;
  });
  readonly errorMessage = signal<string | null>(null);
  readonly drawingBusy = signal(false);
  readonly relationshipSaving = signal(false);
  readonly relationshipSaved = signal(false);
  readonly selectedMemberId = signal<string | null>(null);
  readonly dropTarget = signal<RelationshipType | null>(null);
  readonly relationshipCandidates = signal<Record<RelationshipType, string>>({
    children: '',
    siblings: '',
    spouse: '',
  });
  readonly selectedMember = computed(() => {
    const members =
      this.exchange()?.families.flatMap((family) =>
        family.members.map((member) => ({ ...member, familyName: family.name })),
      ) ?? [];
    return members.find((member) => member.id === this.selectedMemberId()) ?? members[0] ?? null;
  });

  familyName = '';
  familyMembers = '';
  readonly avoidSameFamily = signal(true);

  constructor() {
    effect(() => {
      const exchange = this.exchange();
      if (exchange) {
        this.avoidSameFamily.set(exchange.avoidSameFamily);
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
    this.relationshipCandidates.set({ children: '', siblings: '', spouse: '' });
  }

  setRelationshipCandidate(relationship: RelationshipType, memberId: string): void {
    this.relationshipCandidates.update((candidates) => ({
      ...candidates,
      [relationship]: memberId,
    }));
  }

  async addRelationship(relationship: RelationshipType, memberId?: string): Promise<void> {
    if (this.relationshipSaving()) {
      return;
    }
    const activeMember = this.selectedMember();
    const selectedId = memberId ?? this.relationshipCandidates()[relationship];
    if (!activeMember || !selectedId || selectedId === activeMember.id) {
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
        ? [selectedId]
        : existingIds.includes(selectedId)
          ? existingIds
          : [...existingIds, selectedId];
    await this.persistRelationship(activeMember.id, relationship, updatedIds);
    this.setRelationshipCandidate(relationship, '');
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

  canAddRelationship(relationship: RelationshipType): boolean {
    const activeMember = this.selectedMember();
    const candidateId = this.relationshipCandidates()[relationship];
    if (!activeMember || !candidateId || candidateId === activeMember.id) {
      return false;
    }
    if (relationship === 'spouse') {
      return activeMember.relationships.spouseId !== candidateId;
    }
    const existingIds =
      relationship === 'children'
        ? activeMember.relationships.childrenIds
        : activeMember.relationships.siblingIds;
    return !existingIds.includes(candidateId);
  }

  availableRelationshipFamilies(relationship: RelationshipType) {
    const activeMember = this.selectedMember();
    if (!activeMember) {
      return [];
    }
    const existingIds =
      relationship === 'children'
        ? activeMember.relationships.childrenIds
        : relationship === 'siblings'
          ? activeMember.relationships.siblingIds
          : [];
    return (
      this.exchange()?.families.map((family) => ({
        ...family,
        members: family.members.filter(
          (person) =>
            person.id !== activeMember.id &&
            (!existingIds.includes(person.id) || person.id === activeMember.relationships.spouseId),
        ),
      })) ?? []
    ).filter((family) => family.members.length > 0);
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
      await this.exchanges.saveRules(userId, exchange.id, this.avoidSameFamily());
      if (!canStartDrawing(this.requireExchange())) {
        this.errorMessage.set(
          'These rules cannot make a valid draw with the current families. Add participants, turn off the same-family rule, or skip rules.',
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

  async drawNames(): Promise<void> {
    const userId = this.auth.user()?.uid;
    const exchange = this.requireExchange();
    if (!userId) {
      return;
    }
    this.errorMessage.set(null);
    this.drawingBusy.set(true);
    try {
      const drawing = generateDrawing(exchange);
      if (!drawing) {
        this.errorMessage.set(
          'There is no valid draw for these families and rules. Add participants or adjust the same-family rule.',
        );
        return;
      }
      await this.exchanges.saveDrawing(userId, exchange.id, drawing);
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Could not draw names.');
    } finally {
      this.drawingBusy.set(false);
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
