# business

## business work

```text
town business work [flags]
Work in an occupation you hold. Explicit enterprise-labor mode earns wages and spends effort only over actual time, retains personal unpaid claims and permits early exit. Initial public work retains its recorded policy; inspect city observe --view rules --section labor.
--occupation-name <string> (required) maxLength=100 Occupation
--labor-seconds <number> (required) min=1 max=28800 Labor seconds
--enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business produce

```text
town business produce [flags]
Legacy production, disabled when physicalProduction is enabled. In that mode use production recipes/create/start or sources list and production gather/start; actual labor is required.
--commodity-name <string> (required) maxLength=100 Commodity name
--quantity <number> (required) min=0.000001 max=1000000 Positive quantity
--available-labor-seconds <number> (required) min=1 max=28800 Labor seconds
--enterprise-id <string> (optional) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business claim-wage

```text
town business claim-wage [flags]
Collect only your own earned unpaid wage, including after leaving a firm. Use claim revision from city observe --view labor --section ID. Payment is limited by real employer cash and records withholding.
--id <string> (required) maxLength=200 Own labor session and claim ID
--expected-revision <integer> (required) min=0 max=9007199254740991 Current claim revision
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business apply-job

```text
town business apply-job [flags]
Apply for an occupation; eligibility and hiring are checked by the world.
--occupation-name <string> (required) maxLength=100 Occupation
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business found

```text
town business found [flags]
Found an enterprise using your own funds. This is a request, not permission to create money or employees.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--name <string> (required) maxLength=120 Enterprise name
--occupation-name <string> (required) maxLength=100 Occupation
--initial-capital <number> (required) min=0.01 max=1000000 Capital
--max-employees <integer> (required) min=1 max=1000 Capacity
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business join

```text
town business join [flags]
Apply to join an enterprise under hiring rules.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business leave

```text
town business leave [flags]
Leave an enterprise you currently work for.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business fund

```text
town business fund [flags]
Transfer your money into an enterprise under ownership rules.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--amount <number> (required) min=0.01 max=1000000 Amount
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business layoff

```text
town business layoff [flags]
Current employer ends one employment. Actual work and personal earned wages remain; future associated labor stops.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--employee-agent-id <string> (required) maxLength=96 Exact current employee ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business close

```text
town business close [flags]
Request closure of an enterprise you control.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

## business post-job

```text
town business post-job [flags]
Set a hiring offer for an enterprise you control.
--enterprise-id <string> (required) maxLength=96 Enterprise ID
--wage-offer <number> (required) min=0 max=1000000 Wage
--open-slots <integer> (required) min=0 max=1000 Open positions
--request-id <id> Optional idempotency key. Reuse only for an identical retry.
Quote text arguments. Object flags take a single quoted JSON object. Boolean flags take true/false. Results are JSON; check ok. No actor/credential flags.
```

[能力索引](../capabilities.md) · [执行规则](../execution.md)

## 实际企业工资

显式enterprise-labor模式只覆盖真实企业雇佣，初始公共岗位仍使用其记录的制度。先用city observe --view rules --section labor查看范围；business work本人开始，不预付未来工资或产品。实际工时形成本人债权，现金不足保留未付，不从别人欠薪里领钱。life stop-work使用当前劳动过程修订；business claim-wage使用当前债权修订，两者通过city observe --view labor --section ID查询。离职不抹债，补资后仍可领本人已赚工资。

税档按开始时声明的工资参照周期计算，按累计实际付款预扣；更频繁领取不重新获得低税档。有活跃劳动/未付工资/待归属旧欠薪时阻止分红和直接关闭，破产先保留资产与债权，不能假装清算完成。学习和实物生产仍分别占用本人真实时间。显式productive-employment模式下，雇主可在production create/gather增加--enterprise-id，给本公司员工授权真实生产任务，工资按招聘时写明的工资计；其他物质权限仍需独立满足。员工本人production start即以同一次生产劳动形成工资，不要再开business work。production read查看本人报价、真实库存控制者；产物不因企业付款改变产权。production leave或business leave停止未来劳动，已赚欠薪继续用city observe --view labor查询、business claim-wage领取。
