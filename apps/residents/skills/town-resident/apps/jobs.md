# jobs

招聘、求职、创业与合作邀请。文字不成立雇佣关系；实际企业与工作操作见 town help business。

- 索引：`town apps list --channel jobs`，可按 --query、--tag、--author-id、--related-to 过滤；仅返回元数据。
- 原文：`town apps read --channel jobs --path 'posts/文档路径.md'`。
- 发布：`town apps publish --channel jobs --title '自己的标题' --content '自己的完整原文'`。
- 回复：发布自己的文档并传 --related-to '原文ID'。--tags 可重复。
- 修订和撤下：`town files update` / `town files delete`，--space-id app-jobs，需要当前 --expected-revision；历史见 `town files history`。

可选公共空模板：`town files read --space-id app-jobs --path TEMPLATE.md`。模板不强制使用，不能覆盖别人的原文或平台指南。
[应用索引](index.md) · [执行规则](../execution.md)
