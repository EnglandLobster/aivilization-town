# 远端权威传输

R01继续接入跨机器计算与完整事实同步。本阶段只改变外层监听与认证传输，领域、社会权限、轮次fencing和模拟时钟语义不变。

本机HTTP保留；非回环连接必须HTTPS。endpoint只能是完整origin，禁止用户名/密码、query、fragment、业务前缀和重定向，以免凭据转发到意外地址。CLI、分区worker与只读副本共用同一校验，不能一条路径允许明文远端而另一条拒绝。

服务默认仍监听127.0.0.1。显式配置host与TLS key/cert后可以监听网卡地址或通配地址；通配监听须提供advertise-host，返回给运行者的是可连接地址。远端明文监听拒绝。证书和信任使用Node原生校验，不能关闭主机名或证书验证；私有CA由计算进程启动时NODE_EXTRA_CA_CERTS指定。受限shell仅额外透传此信任文件配置，不透传NODE_OPTIONS、provider凭据或任意宿主执行能力。

验收：默认本机兼容、非回环明文/非法origin/凭据/重定向拒绝，真实TLS服务的认证身份和分区调用，编译CLI正确CA成功、错误CA/主机名失败，真实非回环网络地址下的完整状态与回放。单机多进程网络测试要明确记录，不冒充两台物理机器或生产部署；canonical迁移、孤儿供应商接管、动态归属与25项全量仍未完成。

## 运行入口

先由运行者准备证书、私钥和已有分区配置，再显式启动（示例名称需与证书SAN一致）：

```sh
pnpm residents serve --root WORLD --port 4320 --host 0.0.0.0 --advertise-host town.example --tls-key server.key --tls-cert server.crt --partition-config partitions.json
NODE_EXTRA_CA_CERTS=/trusted/ca.pem pnpm residents partition-daemon --root COMPUTE --source https://town.example:4320 --source-credentials partition-credentials.json --model MODEL
```

公共受信证书不需要额外CA。私钥只部署在权威端，计算端只持有CA和自己的分区凭据；管理凭据只给完整副本接收者。`NODE_EXTRA_CA_CERTS`须在Node进程启动前设置。证书更新通过受控服务重启生效，轮次恢复沿用已有持久机制。

`node apps/residents/scripts/verify-remote-transport.mjs FRESH_DIRECTORY`使用已有`node:24-bookworm-slim`镜像和临时内部Docker网络验收，不下载镜像、不访问供应商、不读取旧实验。每个容器仅挂载必要代码、各自凭据及资源；计算端不挂载权威world、私钥或管理凭据。脚本清理自己创建的容器/网络，保留独立实验与完整结果。

## 当前验收结果

2026-10-07：全仓3172通过/1原跳过，473文件通过/1原跳过，lint/typecheck/相关构建通过。`.local/open-residents/remote-transport-20261007-2/verification.json`记录真实隔离容器TLS验收、一次7单位存款、完整副本回放一致和货币守恒。首轮目录保留测试状态码预期错误；既有分区凭据访问居民接口是404拒绝，并非403，未修改服务授权语义。

新增4项单测覆盖统一origin、本机兼容、监听约束与真实redirect拒绝；容器补充编译shell的CA透传、证书主机名验证、分区/本人/管理权限、完整同步。没有新供应商调用或涌现证据。完整目标与后续优先级见`SOCIETY_GOAL_ALIGNMENT_REVIEW.md`。
