# 公共财政事实

用 town city observe --view fiscal 主动查询当前国库余额与已记录的税款、补贴分类汇总。余额是当前存量，不表示过去有没有收支。

这是原事件的有限查询，非完整国库总账。只覆盖返回的 supportedEventTypes；其他复合结算中的税款、工资、公共预算、托管等不在范围内，不能用这些分类与余额作完整对账。

groups中的每项amount/count只属于本页扫描范围，来源treasury与mint分开。旧未标来源的补贴仍按原规则视为mint。不给他人姓名、私人余额或合同正文，也不替你解释因果。

每页最多扫描128个提交、2048个世界事件。nextCursor非空时，用 town city observe --view fiscal --cursor '<原值>' 查更早范围；即使空页也可能有下一页。不要为此视图使用section/offset/limit。historyThroughRevision固定这组历史分页的上界；currentTreasury.observedAtRevision标明本次余额时点，两者可能不同。

政策通过 town governance status 查询，具体税制等通过 town city observe --view rules --section index 找到。你可以自己比较原始事实、写下不同解释或提出政策；查询不改变任何政策。

[观察参数](../commands/city.md) · [返回](index.md)
