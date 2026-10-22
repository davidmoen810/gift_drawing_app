import 'fake-indexeddb/auto';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { vi } from 'vitest';
import { AuthService } from './auth.service';
import { ExchangePage } from './exchange-page';
import { ExchangeService } from './exchange.service';

describe('ExchangePage drawing order', () => {
  let fixture: ComponentFixture<ExchangePage> | undefined;

  afterEach(() => {
    fixture?.destroy();
    fixture = undefined;
    vi.useRealTimers();
  });

  it('shuffles the roster for five seconds, then shows the name draw button', async () => {
    const userId = globalThis.crypto.randomUUID();
    const params = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [ExchangePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            snapshot: { paramMap: convertToParamMap({}) },
          },
        },
        {
          provide: AuthService,
          useValue: { user: signal({ uid: userId, email: 'guest@example.com' }) },
        },
        ExchangeService,
      ],
    }).compileComponents();

    const exchanges = TestBed.inject(ExchangeService);
    const exchange = await exchanges.create(userId, 'Holiday exchange');
    await exchanges.addFamily(userId, exchange.id, 'Parkers', ['Alex', 'Sam', 'Taylor']);
    await exchanges.confirmMembers(userId, exchange.id);
    await exchanges.skipRules(userId, exchange.id);
    params.next(convertToParamMap({ exchangeId: exchange.id, section: 'drawing' }));

    vi.useFakeTimers();
    fixture = TestBed.createComponent(ExchangePage);
    fixture.detectChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Creating drawing order');
    expect(
      [...fixture.nativeElement.querySelectorAll('button')].some((button) =>
        button.textContent?.includes('Print'),
      ),
    ).toBe(false);
    expect(fixture.nativeElement.querySelector('.drawing-list')?.children.length).toBe(3);
    expect(fixture.nativeElement.textContent).not.toContain('Start name draw');

    vi.advanceTimersByTime(4999);
    fixture.detectChanges();
    expect(fixture.componentInstance.isShufflingNames()).toBe(true);

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    expect(fixture.componentInstance.isShufflingNames()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Start name draw');
    expect(fixture.nativeElement.querySelectorAll('.drawing-member')).toHaveLength(3);
    expect(
      (fixture.nativeElement.querySelector('.step-actions button') as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(fixture.nativeElement.querySelector('.drawing-list')?.tagName).toBe('UL');

    const finalOrder = fixture.componentInstance.drawingOrder().map((member) => member.id);
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(fixture.componentInstance.drawingOrder().map((member) => member.id)).toEqual(finalOrder);
  });

  it('retries invalid draws and never assigns a recipient more than once', async () => {
    const userId = globalThis.crypto.randomUUID();
    const params = new BehaviorSubject(convertToParamMap({}));
    await TestBed.configureTestingModule({
      imports: [ExchangePage],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            snapshot: { paramMap: convertToParamMap({}) },
          },
        },
        {
          provide: AuthService,
          useValue: { user: signal({ uid: userId, email: 'guest@example.com' }) },
        },
        ExchangeService,
      ],
    }).compileComponents();

    const exchanges = TestBed.inject(ExchangeService);
    const exchange = await exchanges.create(userId, 'Holiday exchange');
    const names = ['Parent', 'Child', 'Taylor', 'Jordan', 'Casey'];
    for (const [index, name] of names.entries()) {
      await exchanges.addFamily(userId, exchange.id, `Family ${index}`, [name]);
    }
    await exchanges.confirmMembers(userId, exchange.id);
    const members = exchanges
      .getLoaded(userId, exchange.id)!
      .families.map((family) => family.members[0]);
    await exchanges.setRelationship(userId, exchange.id, members[0].id, 'children', [
      members[1].id,
    ]);
    await exchanges.saveRules(userId, exchange.id, true, true, false, false);
    params.next(convertToParamMap({ exchangeId: exchange.id, section: 'drawing' }));

    vi.useFakeTimers();
    fixture = TestBed.createComponent(ExchangePage);
    fixture.detectChanges();
    fixture.detectChanges();
    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    fixture.componentInstance.drawingOrder.set(
      members.map((member) => ({ id: member.id, name: member.firstName })),
    );

    const randomValues = [0, 1, 4, 0, 3, 0, 0, 0, 0];
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((values) => {
      (values as Uint32Array)[0] = randomValues.shift() ?? 0;
      return values;
    });

    fixture.componentInstance.startNameDraw();
    expect(fixture.componentInstance.nameDrawMessage()).toContain('drew their own name');
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Trying again');
    vi.advanceTimersByTime(800);
    fixture.detectChanges();
    expect(fixture.componentInstance.nameDrawMessage()).toContain(
      'cannot draw the name of their child',
    );

    vi.advanceTimersByTime(2800);
    fixture.detectChanges();
    expect(fixture.componentInstance.nameDrawMessage()).toContain(
      'Parent is giving a gift to Casey',
    );

    vi.advanceTimersByTime(800);
    fixture.detectChanges();
    expect(fixture.componentInstance.nameDrawMessage()).toContain(
      'cannot draw the name of their parent',
    );

    vi.advanceTimersByTime(2800);
    fixture.detectChanges();
    expect(fixture.componentInstance.nameDrawMessage()).toContain(
      'Child is giving a gift to Jordan',
    );

    vi.runAllTimers();
    fixture.detectChanges();

    const assignments = fixture.componentInstance.nameDrawAssignments();
    expect(fixture.componentInstance.nameDrawFinished()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('Starting over');
    expect(fixture.componentInstance.isShufflingNames()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Print');
    expect(fixture.nativeElement.querySelector('.print-document h1')?.textContent).toBe(
      'Holiday exchange',
    );
    expect(fixture.nativeElement.querySelector('.print-results')?.textContent).toContain(
      'Parent drew Casey',
    );
    expect(assignments).toHaveLength(names.length);
    expect(new Set(assignments.map((assignment) => assignment.recipientId)).size).toBe(
      names.length,
    );
    expect(
      assignments.some(
        (assignment) =>
          assignment.giverId === members[0].id && assignment.recipientId === members[1].id,
      ),
    ).toBe(false);
    expect(
      assignments.some(
        (assignment) =>
          assignment.giverId === members[1].id && assignment.recipientId === members[0].id,
      ),
    ).toBe(false);
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const printButton = [...fixture.nativeElement.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Print'),
    ) as HTMLButtonElement;
    printButton.click();
    expect(printSpy).toHaveBeenCalledOnce();

    fixture.componentInstance.startOver();
    fixture.detectChanges();
    expect(fixture.componentInstance.nameDrawStarted()).toBe(false);
    expect(fixture.componentInstance.nameDrawAssignments()).toHaveLength(0);
    expect(fixture.componentInstance.nameDrawFinished()).toBe(false);
    expect(fixture.componentInstance.isShufflingNames()).toBe(true);
    expect(fixture.nativeElement.textContent).not.toContain('Print');

    vi.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(fixture.componentInstance.isShufflingNames()).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Start name draw');

    const orderBeforeRestart = fixture.componentInstance.drawingOrder();
    fixture.componentInstance.nameDrawStarted.set(true);
    fixture.componentInstance.remainingRecipientIds.set([orderBeforeRestart[0].id]);
    fixture.componentInstance.nameDrawAssignments.set([
      {
        giverId: orderBeforeRestart[1].id,
        giver: orderBeforeRestart[1].name,
        recipientId: orderBeforeRestart[2].id,
        recipient: orderBeforeRestart[2].name,
      },
    ]);
    const drawNextRecipient = Reflect.get(
      fixture.componentInstance,
      'drawNextRecipient',
    ) as () => void;
    drawNextRecipient.call(fixture.componentInstance);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Starting over');
    expect(fixture.componentInstance.nameDrawAssignments()).toHaveLength(0);
    expect(fixture.componentInstance.drawingOrder()).toEqual(orderBeforeRestart);

    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Starting over');
    expect(fixture.componentInstance.drawingOrder()).toEqual(orderBeforeRestart);
  });
});
