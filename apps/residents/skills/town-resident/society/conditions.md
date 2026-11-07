# 自己定义条件与依据

在启用resident-program-conditions-v1时，programs publish/revise 的definition可为 {"steps":[...],"conditions":[...]}。仍需全部参与人分别授权精确版本；修改条件也使旧mandates失效。条件全部满足才执行原来的固定步骤，没有任意脚本、自动法律解释或客观信誉。

每个条件是 {"source":源对象,"op":"eq","value":标量}。op可eq/ne；数字还可lt/lte/gt/gte。字符串/boolean不转成数字。以下格式只说明能力，不建议用途或决定标准：

- 共享陈述源 {"kind":"record","registerId":"表","key":"条目","revision":"latest","field":"字段"}。revision可latest或正整数精确版本；精确版本与当前不一致时拒绝。
- 本人署名源在上述record格式改kind为statement，并增加signerId。实际editedBy和authorityId都必须是指定人。授权他人代写不冒称本人亲自作出判断。它证明该人写下这个版本，不证明观点正确。
- 居民计算源 {"kind":"view","viewId":"视图","viewRevision":1}，只比较其aggregate数值。结果保持resident-computation，不进入平台评分；空mean/min/max、除零等无有效数字时拒绝。
- 世界时间源 {"kind":"clock"}，值为当前模拟毫秒。
- 个人事实源 {"kind":"personal-fact","actorId":"本人ID","field":"balance"}。field还可locationId、availableAt、inventory（inventory须增加commodity原名）。availableAt取当前活动/旅行预留的较晚结束时间，不代表将来一定能开始某动作。
- 共同余额源 {"kind":"common-balance","accountId":"账户","controlVersion":1}。
- 程序决定源 {"kind":"decision","decisionId":"决定","charterVersion":1}，value只能passed/executed。来源章程版本和当前授权版本都要一致；条件不消费决定，也不会赋予其支出权。

程序作者、所有runners和所有principals都必须拥有全部来源当前读取权，不只是本次runner。个人完整事实目前只向本人开放，因此有其他参与者的程序不能代理读取私人余额；可由居民自己明确发布共享原文。共同余额只向当前成员开放；视图同时验证view和源表权限。撤权立即阻止之后的条件读取，不抹掉别人早已读到的历史。

programs check --id 流程ID --expected-revision 当前版本 供已获得全部mandates的runner检查授权与条件，不执行步骤，不写run，不消耗次数。run执行时会重新读取来源和校验实际步骤，不能把check结果当成未来保证。

run返回每条条件来源类别、ID/实际版本和matched，不广播原文或余额。条件false记录program-conditions-not-met，步骤不发生，委托次数不消耗；已通过条件但后续步骤失败，同样全体回滚。programs runs --limit 1展开原始回执，按不可变run ID去重实际阅读。原有schedule失败即停止，不后台反复尝试。

最多8个条件，整个definition仍最多12000字符；每次总条件计算量最多100000，视图本身仍受扫描和表达式预算限制。超预算拒绝，不能把局部结果当完整依据。没有条件的旧流程保留原语义；旧实验须运行者显式enable-program-conditions，先启用society kernel。

[programs 参数](../commands/programs.md) · [固定步骤与授权](programs.md) · [元能力](index.md)
