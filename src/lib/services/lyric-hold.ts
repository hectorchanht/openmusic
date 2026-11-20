// quick-260926-vur: the lyrics pane's hold/resume decision machine — PURE, node-tested, no DOM.
//
// Root cause it fixes: the pane tracked the finger with pointer events and treated `pointercancel`
// as a lift. Android Chrome/WebView and iOS Safari fire `pointercancel` the instant a touch turns
// into a native scroll — with the finger STILL down — so the 3 s resume armed mid-hold and
// auto-centre yanked a peeked lyric back. Touch events (`touchstart`/`touchend`/`touchcancel`) keep
// firing through a native scroll and `touchend` is the real lift, so touch AND pen go through them;
// the pointer path stays only for the mouse (a mouse has no scroll takeover).
//
// NpLyrics maps each action: 'suspend' → autoScroll=false + clear the timer; 'arm' → autoScroll=false
// + restart the RESUME_MS timer (which dispatches 'tick'); 'resume' → clear the timer + autoScroll=true.

export interface HoldState {
	/** Touch contacts currently down (e.touches.length). */
	touches: number;
	/** A mouse button is down on the pane. */
	mouse: boolean;
	/** Auto-centre is off (held, or inside the post-release grace). */
	suspended: boolean;
}

export type HoldEvent =
	| { type: 'touch'; touches: number } // touchstart/touchend/touchcancel: contacts REMAINING
	| { type: 'mouse'; down: boolean } // pointerdown/pointerup/pointercancel with pointerType 'mouse'
	| { type: 'wheel' }
	| { type: 'scroll' }
	| { type: 'force' } // seek / slider: resume now
	| { type: 'tick' }; // the RESUME_MS timer fired

export type HoldAction = 'suspend' | 'arm' | 'resume' | 'none';

export const HOLD_IDLE: HoldState = Object.freeze({ touches: 0, mouse: false, suspended: false });

const held = (s: HoldState) => s.touches > 0 || s.mouse;

export function holdStep(s: HoldState, e: HoldEvent): { state: HoldState; action: HoldAction } {
	switch (e.type) {
		case 'touch': {
			const state = { ...s, touches: e.touches };
			if (e.touches > 0) {
				// Already held → nothing is armed (scroll/tick no-op while held), so a 2nd finger is a no-op.
				return { state: { ...state, suspended: true }, action: held(s) && s.suspended ? 'none' : 'suspend' };
			}
			return { state, action: s.suspended && !s.mouse ? 'arm' : 'none' };
		}
		case 'mouse': {
			const state = { ...s, mouse: e.down };
			if (e.down) return { state: { ...state, suspended: true }, action: 'suspend' };
			return { state, action: s.suspended && s.touches === 0 ? 'arm' : 'none' };
		}
		case 'wheel':
			// No release event exists for a wheel: pause and arm the same grace at once.
			return { state: { ...s, suspended: true }, action: 'arm' };
		case 'scroll':
			// Idle: the anchor pass's own smooth scroll must not re-suspend. Held: no timer until the lift.
			// Otherwise momentum after a lift keeps pushing the resume out.
			if (!s.suspended || held(s)) return { state: { ...s }, action: 'none' };
			return { state: { ...s }, action: 'arm' };
		case 'force':
			return { state: { ...s, suspended: false }, action: 'resume' };
		case 'tick':
			if (held(s)) return { state: { ...s }, action: 'none' };
			return { state: { ...s, suspended: false }, action: 'resume' };
	}
}

/** Mouse only; touch and pen return null — the touch-event path owns them. */
export function pointerHoldEvent(pointerType: string, down: boolean): HoldEvent | null {
	return pointerType === 'mouse' ? { type: 'mouse', down } : null;
}
