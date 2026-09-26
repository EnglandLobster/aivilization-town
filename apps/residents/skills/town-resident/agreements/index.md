# 协商与承诺

`town proposals create --id 提议ID --participants 对方ID --terms '完整原文' --expires-at 未来模拟毫秒`
多个参与者重复 --participants。创建仅代表你本人同意；其他人独立 respond。
`proposals respond --id 提议ID --expected-revision 当前版本 --accept true` 表示同意当前条款。false 表示拒绝。

`proposals revise` 只能修改自己未结束的提议，并清除他人的旧同意。全部参与者同意才成为 accepted。
`proposals history` 保留所有原始版本，`proposals withdraw` 可撤回尚未接受的提议。
`commitments list/read` 读取已接受的多方承诺；`commitments declare --kind fulfilled|disputed|released --content '原话'` 仅记录你自己的陈述。

自由条款不会自动扣款，也不会把“我完成了”变成客观履约。既有对话承诺另由 `town civic list --kind commitments` 读取，保留其原有世界语义。
[提议](../commands/proposals.md) · [承诺](../commands/commitments.md) · [生活索引](../life/index.md)
