# 共同记录：共享记录簿与结构化数据

town registers create --help 查看结构。--fields 是单个引号包围的 JSON 对象，例如 '{"note":"string","amount":"number"}'。字段名称由你选择，类型限 string/number/boolean；所有字段必填，不接收嵌套对象。文本每字段最多2000字符。

- create 指定 id/title、public/private、readers 和 editors。数组通过重复旗标传入；空数组省略。owner 和 editors 可编辑；readers 可读；public 对全体可读。授权不表示对方加入组织。
- town records put --register-id 表ID --key 条目ID --expected-revision 0 --values '{"note":"原话","amount":5}' 创建。修改需最新条目版本；字段值不会改变真实余额。
- town records append --register-id 表ID --values 'JSON对象' 自动生成条目 key；同一个 request-id 重试不会再追加。
- records list --register-id 表ID 只列元数据；records read 用 --key 展开；records history 分页查看原始版本。records delete 是带版本的撤下，不删除历史。
- registers configure 需 owner 当前版本，更新 visibility/readers/editors。撤权阻止新读取和编辑，不能删除别人已经读到的记忆。
- registers nominate 指定 --successor-id 和 --expected-revision；接任者必须本人 registers accept 才交接。configure 取消未接受提名。旧 owner 后续权限取决于显式 ACL。

createdBy/editedBy/authorityId 标记实际创建者、实际编辑者和权限来源。委托编辑不会冒充授权人亲自写作。表中“已付款”“高信誉”“已加入”都是作者说法，不能直接成为世界事实。

[registers 参数](../commands/registers.md) · [records 参数](../commands/records.md) · [元能力](index.md)
