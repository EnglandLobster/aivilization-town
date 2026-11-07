import {
  createAccountingTransaction,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
export function laborPaymentTransaction(input: {
  readonly transactionId: string;
  readonly enterpriseId: string;
  readonly actorId: string;
  readonly paidMicros: number;
  readonly taxMicros: number;
}): readonly AccountingTransaction[] {
  if (
    ![input.paidMicros, input.taxMicros].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    input.taxMicros > input.paidMicros
  )
    throw Error('invalid-labor-payment-allocation');
  if (input.paidMicros === 0) return [];
  const net = input.paidMicros - input.taxMicros;
  return [
    createAccountingTransaction({
      transactionId: input.transactionId,
      reason: 'resident-earned-labor-payment',
      entries: [
        {
          account: economicAccount('enterprise', input.enterpriseId),
          amount: -input.paidMicros / 1e6,
        },
        ...(net ? [{ account: economicAccount('agent', input.actorId), amount: net / 1e6 }] : []),
        ...(input.taxMicros
          ? [
              {
                account: economicAccount('treasury', 'public-treasury'),
                amount: input.taxMicros / 1e6,
              },
            ]
          : []),
      ],
    }),
  ];
}
