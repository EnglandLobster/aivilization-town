# 明确设施来源的后续登记

## 边界

旧地点的名称、用途或人数容量不是护理位/教学位的历史来源。本迁移只接受明确新增的运行者资源声明，不将旧诊所/学校猜测成已经具有设备，也不把居民文件或集体提案解释为制造物理设施。居民自行建设仍走原材料、实际劳动与建设流程。

premises继续拥有ServiceFacilityEndowment、地点唯一性、有限数量及来源；world核验地点存在及一位提供者和一位参与者所需的真实人数容量，原子应用整批。worker只处理运行者入口、幂等和journal；居民不能调用该登记。未结束居民轮次拒绝插入，不伪造提供者时间/许可/报价/合同/身体同意。

## 命令与事件

`register-service-facilities --root DIR --args JSON` 接受1至64个对象的数组，每个精确包含locationId、careStations、teachingStations、sourceId。只有authorized-extension来源由服务器写入；缺少/额外字段拒绝。数量与非空来源使用现有premises不变量。地点总人数必须容纳两倍station数。

`ResidentServiceFacilitiesRegistered` 采用declared-service-facilities-v1，记录最终有限设施与来源；只允许服务与premises已经启用的世界。回放重新校验来源、时间、真实位置容量和premises原状态，但不重新作经营决策。已有地点设施或实体建筑不可覆盖，批中任何失败不产生部分资源。

同一规范声明经system请求ID重试不再次添置或写journal；改变声明不能覆盖已登记地点。原manifest、历史事件、旧初始化来源不变。原服务启用的设施容量检查与该后续入口共用world容量端口，保留旧事件错误/有效语义。

## 交付与验收

既有 `town engagements facilities` 按需显示容量和完整来源；不增加居民工具或默认上下文。登记并不等于设施正在被居民使用，更不等于已经形成医院或学校。护理/教学实际效果仍需现有约定、人员、材料、时间和身体授权。

覆盖批原子性、容量边界、非法数据、覆盖拒绝、活动轮次拒绝、回放来源伪造、旧世界无隐式设施、只读发现、重试与重开。真实CLI与模型采用另行留证；完整旧场所产权/建筑来源迁移、医学模型范围和全运行模式仍属于原25项目标。


工程验收：新登记与既有服务路径21项测试通过；真实编译CLI新增护理位后13次居民调用含4次预期拒绝，实际照护、身体占用、收费/退未用费、隐私与重启回放通过。全仓3291通过/1跳过、499文件通过/1跳过；lint、全仓typecheck、全仓build、最终world build和格式检查通过。证据 `../evidence/SOCIETY_DECLARED_SERVICE_FACILITIES_2026-10-07.json`。
