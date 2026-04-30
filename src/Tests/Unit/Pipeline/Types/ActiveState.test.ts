/**
 * Unit tests for Types/ActiveState — module-level phase & stage getters/setters.
 */

import {
  getActivePhase,
  getActiveStage,
  setActivePhase,
  setActiveStage,
} from '../../../../Scrapers/Pipeline/Types/ActiveState.js';

describe('ActiveState', () => {
  it('setActivePhase updates active phase name', () => {
    setActivePhase('login');
    const getActivePhaseResult1 = getActivePhase();
    expect(getActivePhaseResult1).toBe('login');
  });

  it('setActivePhase returns true', () => {
    const didSetPhase = setActivePhase('dashboard');
    expect(didSetPhase).toBe(true);
  });

  it('setActiveStage updates active stage name', () => {
    setActiveStage('ACTION');
    const getActiveStageResult2 = getActiveStage();
    expect(getActiveStageResult2).toBe('ACTION');
  });

  it('setActiveStage returns true', () => {
    const didSetStage = setActiveStage('POST');
    expect(didSetStage).toBe(true);
  });

  it('overwrites previous phase on subsequent set', () => {
    setActivePhase('init');
    setActivePhase('scrape');
    const getActivePhaseResult3 = getActivePhase();
    expect(getActivePhaseResult3).toBe('scrape');
  });

  it('supports all four stage labels', () => {
    const stages = ['PRE', 'ACTION', 'POST', 'FINAL'] as const;
    for (const s of stages) {
      setActiveStage(s);
      const getActiveStageResult4 = getActiveStage();
      expect(getActiveStageResult4).toBe(s);
    }
  });
});
