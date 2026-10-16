// Scenarios: physical consistency of the evaluation and sweeps.
import { describe, expect, it } from 'vitest';
import { DEFAULT_BEAM, DEFAULT_FACE, DEFAULT_RADAR, faceGeometry } from '../src/engine/config';
import { computeWeights, steerUV } from '../src/engine/array';
import { elevationCut, gainAt } from '../src/engine/pattern';
import { DEFAULT_ENV } from '../src/engine/environment';
import { SCENARIOS, SWEEP_PARAMS, applyScenario, evaluate, runSweep, sweepCsv, type AntennaSummary } from '../src/engine/scenarios';

const g = faceGeometry(DEFAULT_FACE);
const w = computeWeights(DEFAULT_FACE, g, DEFAULT_BEAM, new Uint8Array(g.N));
const cut = elevationCut(g, w, DEFAULT_FACE.f0, steerUV(0, 0)[0], 0.05);
let pk = -Infinity; for (const v of cut.gainDbi) pk = Math.max(pk, v);
const G = gainAt(g, w, DEFAULT_FACE.f0, Float64Array.of(0), Float64Array.of(0))[0];
const ant: AntennaSummary = {
  fHz: DEFAULT_FACE.f0, gtDbi: G + 1.5, grDbi: G, nActive: g.N, hpbwAzDeg: 1.7, hpbwElDeg: 1.7,
  ang: cut.angDeg, gain: cut.gainDbi, peakDbi: pk, elSteerDeg: 0, beamAzDeg: 0,
};
const sc = (id: string) => { const s = SCENARIOS.find(x => x.id === id)!; return { s, ...applyScenario(s, DEFAULT_ENV, DEFAULT_RADAR) }; };

describe('scenarios', () => {
  it('S1: a fighter at 5 km altitude is limited by SNR or horizon, without clutter', () => {
    const { s, env, radar } = sc('s1');
    const r = evaluate(ant, env, radar, { envelope: true, refRangeKm: s.refRangeKm });
    expect(r.rFirstKm).toBeGreaterThan(150);
    expect(r.rFirstKm).toBeLessThanOrEqual(r.rHorKm * 1.01);
    expect(r.limit).not.toBe('clutter');
  });
  it('S2: with two-ray only, the low target is not seen beyond the horizon and raising the antenna extends it', () => {
    const { s, env, radar } = sc('s2');
    const go = { ...env, propPE: false };
    const lo = evaluate(ant, go, { ...radar, hRadarM: 10 }, { envelope: true, refRangeKm: s.refRangeKm });
    const hi = evaluate(ant, go, { ...radar, hRadarM: 35 }, { envelope: true, refRangeKm: s.refRangeKm });
    expect(lo.rFirstKm).toBeLessThanOrEqual(lo.rHorKm * 1.01);
    expect(hi.rHorKm).toBeGreaterThan(lo.rHorKm);
    expect(hi.rFirstKm).toBeGreaterThan(lo.rFirstKm);
  });
  it('S2: the parabolic equation (diffraction and ducting) only adds range beyond the horizon', () => {
    const { s, env, radar } = sc('s2');
    const go = evaluate(ant, { ...env, propPE: false }, radar, { envelope: true, refRangeKm: s.refRangeKm });
    const pe = evaluate(ant, { ...env, propPE: true }, radar, { envelope: true, refRangeKm: s.refRangeKm });
    expect(pe.rFirstKm).toBeGreaterThanOrEqual(go.rFirstKm - 0.5);
    expect(pe.rFirstKm).toBeLessThan(go.rHorKm * 3);
  });
  it('more clutter cancellation never worsens SINR', () => {
    const { s, env, radar } = sc('s5');
    const a = evaluate(ant, { ...env, cancelPhys: false, cancelDb: 10 }, radar, { envelope: true, refRangeKm: s.refRangeKm });
    const b = evaluate(ant, { ...env, cancelPhys: false, cancelDb: 50 }, radar, { envelope: true, refRangeKm: s.refRangeKm });
    expect(b.sinrRefDb).toBeGreaterThanOrEqual(a.sinrRefDb - 1e-9);
  });
  it('a lower-sidelobe Doppler window or a more stable transmitter never worsens SINR', () => {
    const { s, env, radar } = sc('s5');
    const o = { envelope: true, refRangeKm: s.refRangeKm };
    // the window also changes its gain loss: compare only the cancellation (clutter)
    const base = evaluate(ant, { ...env, cancelPhys: true, jitterDeg: 0.5 }, { ...radar, dopplerSllDb: 40 }, o);
    const win = evaluate(ant, { ...env, cancelPhys: true, jitterDeg: 0.5 }, { ...radar, dopplerSllDb: 60 }, o);
    const tx = evaluate(ant, { ...env, cancelPhys: true, jitterDeg: 0.05 }, { ...radar, dopplerSllDb: 40 }, o);
    expect(win.cnrRefDb).toBeLessThanOrEqual(base.cnrRefDb + 1e-9);
    expect(tx.sinrRefDb).toBeGreaterThanOrEqual(base.sinrRefDb - 1e-9);
  });
});

describe('sweeps', () => {
  it('RCS +10 dB extends free-space range by a factor of 10^(1/4)', () => {
    const { s, env, radar } = sc('s1');
    const p = SWEEP_PARAMS.find(q => q.key === 'rcsDb')!;
    const r = runSweep(ant, { env, radar, opt: { envelope: true, refRangeKm: s.refRangeKm } }, p, 0, 10, 2, 'none');
    expect(r.series[0].res[1].rFsKm / r.series[0].res[0].rFsKm).toBeCloseTo(Math.pow(10, 0.25), 3);
    const csv = sweepCsv(r, 'S1');
    expect(csv.split('\n').length).toBe(5);     // comment + header + 2 rows + trailing
  });
});
