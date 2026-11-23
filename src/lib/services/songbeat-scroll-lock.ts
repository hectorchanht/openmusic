// songbeat-scroll-lock — Song Beat's scroll LOCK state (quick-261122-npfix, Hector 2026-11-22).
//
// The game surface sits inside the Now Playing sheet's scrolling panel, so a slightly-off pad tap
// or a hold that drifts used to scroll the panel out from under the player mid-round. The lock
// PINS that scroller while a round is live.
//
//   • AUTO-PIN: a round START locks (fresh run, restart, play-again).
//   • The VISIBLE toggle (top corner of the game surface, ≥44px) is the lock's face AND its
//     manual override — the icon shows the CURRENT state one-to-one (locked = Lock, unlocked =
//     LockOpen); a tap flips it at any time, mid-round included.
//   • A round END (complete / failed) releases it so the results card can scroll. A manual
//     unlock mid-round is respected until the next round start re-pins.
//
// Pure reducer — no runes, no DOM — so the rules are node-testable; NpGame holds the value in a
// $state and the DOM pinning lives in actions/pinScroll.ts.

export type ScrollLockEvent = 'roundStart' | 'roundEnd' | 'toggle';

export function nextScrollLock(locked: boolean, ev: ScrollLockEvent): boolean {
	switch (ev) {
		case 'roundStart':
			return true;
		case 'roundEnd':
			return false;
		case 'toggle':
			return !locked;
	}
}
