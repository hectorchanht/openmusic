import { describe, it, expect } from 'vitest';
import { holdStep, pointerHoldEvent, HOLD_IDLE, type HoldEvent, type HoldState, type HoldAction } from './lyric-hold';

// quick-260926-vur — the lyrics pane's hold/resume machine. A touch hold must survive a native
// scroll takeover (pointercancel with the finger still down); resume arms only on the real lift.

/** Run events from HOLD_IDLE; returns the final state and every action in order. */
function run(...events: HoldEvent[]): { state: HoldState; actions: HoldAction[] } {
	let state = HOLD_IDLE;
	const actions: HoldAction[] = [];
	for (const e of events) {
		const r = holdStep(state, e);
		state = r.state;
		actions.push(r.action);
	}
	return { state, actions };
}

const touch = (touches: number): HoldEvent => ({ type: 'touch', touches });

describe('holdStep', () => {
	it('a touch hold survives a scroll takeover — no timer while held', () => {
		expect(pointerHoldEvent('touch', false)).toBeNull(); // a touch pointercancel never reaches it
		const { state, actions } = run(touch(1), { type: 'scroll' });
		expect(actions).toEqual(['suspend', 'none']);
		expect(state.suspended).toBe(true);
	});

	it('lift then momentum re-arms on every scroll; the tick resumes', () => {
		const { state, actions } = run(touch(1), touch(0), { type: 'scroll' }, { type: 'scroll' }, { type: 'tick' });
		expect(actions).toEqual(['suspend', 'arm', 'arm', 'arm', 'resume']);
		expect(state.suspended).toBe(false);
	});

	it('a tick while still held does nothing', () => {
		const { state, actions } = run(touch(1), { type: 'tick' });
		expect(actions).toEqual(['suspend', 'none']);
		expect(state.suspended).toBe(true);
	});

	it('multi-touch: still held until the last contact lifts', () => {
		const { actions } = run(touch(1), touch(2), touch(1), touch(0));
		expect(actions).toEqual(['suspend', 'none', 'none', 'arm']);
		expect(run(touch(1), touch(2), touch(1)).state.suspended).toBe(true);
	});

	it('mouse: press suspends through scrolling; release arms; tick resumes', () => {
		expect(pointerHoldEvent('mouse', true)).toEqual({ type: 'mouse', down: true });
		const up = pointerHoldEvent('mouse', false)!;
		const { state, actions } = run(pointerHoldEvent('mouse', true)!, { type: 'scroll' }, up, { type: 'tick' });
		expect(actions).toEqual(['suspend', 'none', 'arm', 'resume']);
		expect(state).toEqual(HOLD_IDLE);
	});

	it('pen is routed to the touch path', () => {
		expect(pointerHoldEvent('pen', true)).toBeNull();
		expect(pointerHoldEvent('touch', true)).toBeNull();
	});

	it('wheel suspends and arms at once; tick resumes', () => {
		const w = run({ type: 'wheel' });
		expect(w.actions).toEqual(['arm']);
		expect(w.state.suspended).toBe(true);
		expect(run({ type: 'wheel' }, { type: 'tick' }).actions).toEqual(['arm', 'resume']);
	});

	it('force resumes; a later scroll while idle stays idle (the anchor pass never re-suspends)', () => {
		const { state, actions } = run(touch(1), touch(0), { type: 'force' }, { type: 'scroll' });
		expect(actions).toEqual(['suspend', 'arm', 'resume', 'none']);
		expect(state.suspended).toBe(false);
	});

	it('a lift when not suspended does nothing', () => {
		const { state, actions } = run(touch(0));
		expect(actions).toEqual(['none']);
		expect(state.suspended).toBe(false);
	});

	it('never mutates the input state', () => {
		const before = { ...HOLD_IDLE };
		holdStep(HOLD_IDLE, touch(1));
		expect(HOLD_IDLE).toEqual(before);
	});
});
