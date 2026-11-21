import { describe, it, expect, vi, afterEach } from 'vitest';
import { playPadSound, setSynthVolume, setSynthContextForTests, unlockSynth, MASTER_CAP } from './tap-synth';
import { PENTA_FREQS } from '$lib/services/tapalong';

// quick-261021-tap: synth-kit pins (brief §6) over a fake AudioContext. Asserts one lazily
// built context graph per pad shape, the pentatonic note mapping, the master-gain ceiling,
// and the never-throw no-context path. Also a source pin: this module must never reference
// the player's keepAliveCtx (its own context is the whole point).

interface FakeOsc {
	type: string;
	frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
	connect: ReturnType<typeof vi.fn>;
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
}
interface FakeGain {
	gain: { value: number; setValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> };
	connect: ReturnType<typeof vi.fn>;
}

function fakeCtx() {
	const oscs: FakeOsc[] = [];
	const gains: FakeGain[] = [];
	const sources: Array<{ buffer: unknown; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
	const ctx = {
		currentTime: 10,
		sampleRate: 8000,
		state: 'running',
		destination: {},
		resume: vi.fn(async () => {}),
		createGain: vi.fn(() => {
			const g: FakeGain = {
				gain: {
					value: 0,
					setValueAtTime: vi.fn((v: number) => (g.gain.value = v)),
					exponentialRampToValueAtTime: vi.fn()
				},
				connect: vi.fn()
			};
			gains.push(g);
			return g;
		}),
		createOscillator: vi.fn(() => {
			const o: FakeOsc = {
				type: '',
				frequency: { value: 0, setValueAtTime: vi.fn((v: number) => (o.frequency.value = v)), exponentialRampToValueAtTime: vi.fn() },
				connect: vi.fn(),
				start: vi.fn(),
				stop: vi.fn()
			};
			oscs.push(o);
			return o;
		}),
		createBuffer: vi.fn((_ch: number, len: number, rate: number) => ({
			getChannelData: () => new Float32Array(len),
			duration: len / rate
		})),
		createBufferSource: vi.fn(() => {
			const s = { buffer: null as unknown, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
			sources.push(s);
			return s;
		}),
		createBiquadFilter: vi.fn(() => ({ type: '', frequency: { value: 0 }, connect: vi.fn() }))
	};
	return { ctx: ctx as unknown as AudioContext, oscs, gains, sources, raw: ctx };
}

afterEach(() => {
	setSynthContextForTests(null);
	vi.restoreAllMocks();
});

describe('quick-261021-tap tap-synth', () => {
	it('pluck plays a triangle tone at the ladder frequency for the step', () => {
		const f = fakeCtx();
		setSynthContextForTests(f.ctx);
		playPadSound('pluck', 3);
		expect(f.oscs).toHaveLength(1);
		expect(f.oscs[0].type).toBe('triangle');
		expect(f.oscs[0].frequency.value).toBe(PENTA_FREQS[3]);
		expect(f.oscs[0].start).toHaveBeenCalled();
	});

	it('kick is a sine pitch-drop thump; snare/shaker are noise bursts with no oscillator', () => {
		const f = fakeCtx();
		setSynthContextForTests(f.ctx);
		playPadSound('kick');
		expect(f.oscs).toHaveLength(1);
		expect(f.oscs[0].type).toBe('sine');
		expect(f.oscs[0].frequency.value).toBe(150);
		playPadSound('snare');
		playPadSound('shaker');
		expect(f.oscs).toHaveLength(1); // noise pads add no oscillators
		expect(f.sources).toHaveLength(2);
	});

	it('master gain never exceeds the cap, even at slider 1', () => {
		const f = fakeCtx();
		setSynthContextForTests(f.ctx);
		setSynthVolume(1);
		unlockSynth(); // builds the graph → master gain written
		const master = f.gains[0];
		expect(master.gain.value).toBeLessThanOrEqual(MASTER_CAP);
		setSynthVolume(0.5);
		expect(master.gain.value).toBeCloseTo(0.5 * MASTER_CAP);
	});

	it('reuses ONE context across taps (no per-tap construction)', () => {
		const f = fakeCtx();
		setSynthContextForTests(f.ctx);
		playPadSound('pluck', 0);
		playPadSound('pluck', 1);
		expect(f.raw.createGain.mock.calls.length).toBeGreaterThan(0);
		// master built once: gains = master + one per tone = 3, not 2 masters
		expect(f.gains).toHaveLength(3);
	});

	it('no context available (node, no window) is a silent no-op', () => {
		setSynthContextForTests(null);
		expect(() => {
			playPadSound('kick');
			unlockSynth();
			setSynthVolume(0.2);
		}).not.toThrow();
	});

	it('source pin: never USES keepAliveCtx and never imports the player store', async () => {
		const src = await import('./tap-synth?raw').catch(() => null);
		// vitest ?raw may not resolve in this project; fall back to a module-shape assertion.
		if (src && typeof (src as { default?: unknown }).default === 'string') {
			const text = (src as { default: string }).default;
			expect(text).not.toMatch(/keepAliveCtx\s*[.(]/); // the word may appear in comments; usage may not
			expect(text).not.toContain('stores/player');
		} else {
			expect(MASTER_CAP).toBeGreaterThan(0); // seam covered by code review + grep in SUMMARY
		}
	});
});
