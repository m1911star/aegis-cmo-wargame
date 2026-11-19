import { describe, expect, test } from 'bun:test';
import { projectFirstExerciseCard } from '../../../src/components/FirstExerciseCard';
import { INFORMATION_EXERCISE } from '../../../src/scenarios/informationExercise';
import type { TacticalContact } from '../../../src/types/wargame';

const objectives = INFORMATION_EXERCISE.objectives!;
const redContact: TacticalContact & { hp: number } = {
  id: 'red-track',
  actualUnitId: 'hidden-blue-unit',
  observerSide: 'RED',
  targetSide: 'BLUE',
  domain: 'surface',
  classification: 'classified',
  displayName: '观测接触 A',
  sidc: '',
  estimatedPosition: [125, 25],
  truePosition: [124, 26],
  uncertaintyRadiusKm: 20,
  heading: 0,
  speedKts: 0,
  altitudeM: 0,
  firstDetectedTime: 0,
  lastDetectedTime: 0,
  detectedBySources: [],
  threatLevel: 'low',
  hp: 100,
};
const blueContact: TacticalContact = {
  ...redContact,
  id: 'blue-track',
  observerSide: 'BLUE',
  targetSide: 'RED',
  actualUnitId: 'hidden-red-unit',
  displayName: '观测接触 B',
  classification: 'unknown',
};

describe('first exercise card projection', () => {
  test('shows the primary goal and only the observing seat’s report', () => {
    const contacts = { [blueContact.id]: blueContact, [redContact.id]: redContact };
    expect(projectFirstExerciseCard('RED', objectives, contacts)).toEqual({
      primaryGoal: '使演练目标失能或被摧毁',
      contact: {
        id: 'red-track', displayName: '观测接触 A', classification: 'classified',
        estimatedPosition: [125, 25], uncertaintyRadiusKm: 20,
      },
    });
    expect(projectFirstExerciseCard('BLUE', objectives, contacts)).toEqual({
      primaryGoal: '保护演练目标能力至结束',
      contact: {
        id: 'blue-track', displayName: '观测接触 B', classification: 'unknown',
        estimatedPosition: [125, 25], uncertaintyRadiusKm: 20,
      },
    });
  });

  test('shows the goal without intel when the seat has no contact', () => {
    const goalOnly = { primaryGoal: '使演练目标失能或被摧毁' };
    expect(projectFirstExerciseCard('RED', objectives, {})).toEqual(goalOnly);
    expect(projectFirstExerciseCard('RED', objectives, { [blueContact.id]: blueContact })).toEqual(goalOnly);
  });
});
