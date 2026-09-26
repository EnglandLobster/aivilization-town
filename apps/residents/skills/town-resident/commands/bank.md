# bank

## bank deposit

```text
town bank deposit [flags]
Deposit your money into the town bank.
--amount <number> (required) min=0.01 max=1000000 Amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bank withdraw

```text
town bank withdraw [flags]
Withdraw from your bank deposit.
--amount <number> (required) min=0.01 max=1000000 Amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## bank borrow

```text
town bank borrow [flags]
Request a bank loan subject to credit and reserve rules.
--amount <number> (required) min=0.01 max=1000000 Amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)
