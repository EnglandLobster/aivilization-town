# market

## market trade

```text
town market trade [flags]
Buy or sell in your currently accessible market. Prices, slippage, inventory and balance are checked by the world.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--side <buy|sell> (required)
--enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## market give

```text
town market give [flags]
Give a commodity you own to another resident under world rules.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--target-agent-id <string> (required) maxLength=96 Recipient ID
--note <string> (optional) maxLength=300 Your note
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## market export

```text
town market export [flags]
Export goods through the external market under world rules.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--as-enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## market import

```text
town market import [flags]
Import goods through the external market under world rules.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--as-enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)
