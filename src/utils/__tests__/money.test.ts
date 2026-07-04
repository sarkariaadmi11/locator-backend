import {round2, splitCommission} from '../money';

describe('money.round2', () => {
  it('rounds to 2 decimal places', () => {
    expect(round2(10.005)).toBeCloseTo(10.01, 2);
    expect(round2(10.004)).toBeCloseTo(10, 2);
  });
});

describe('money.splitCommission', () => {
  it('splits a ₹100 reward at 15% commission into ₹15/₹85', () => {
    expect(splitCommission(100, 15)).toEqual({commissionAmount: 15, creatorEarnings: 85});
  });

  it('splits a ₹1000 reward at 15% commission into ₹150/₹850', () => {
    expect(splitCommission(1000, 15)).toEqual({commissionAmount: 150, creatorEarnings: 850});
  });

  it('never loses or duplicates paise — commission + earnings always sum back to the input', () => {
    for (const amount of [10, 33.33, 250.5, 2000]) {
      const {commissionAmount, creatorEarnings} = splitCommission(amount, 15);
      expect(round2(commissionAmount + creatorEarnings)).toBeCloseTo(amount, 2);
    }
  });

  it('produces a zero commission at a 0% rate', () => {
    expect(splitCommission(100, 0)).toEqual({commissionAmount: 0, creatorEarnings: 100});
  });
});
