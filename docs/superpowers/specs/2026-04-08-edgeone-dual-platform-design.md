# BetterClaude 双平台部署设计

- 日期：2026-04-08
- 主题：Cloudflare Workers + 腾讯云 EO Pages 双平台支持
- 状态：设计已确认，待实现

## 1. 背景

当前仓库是一个基于 Cloudflare Workers 的 Claude API 代理，核心能力是：

- 代理 `/claude/{host}/v1/messages`
- 透传大部分请求头和客户端信息
- 在请求发送前主动清理 orphaned `tool_result`
- 在遇到特定 400 错误时执行一次补偿重试

当前实现入口集中在 [`src/index.ts`](../../../src/index.ts)，整体结构偏向单平台。

本次设计目标不是做一次性迁移，而是让项目同时支持：

- Cloudflare Workers
- 腾讯云 EO Pages

并保持相同的对外 API 契约与相同的核心行为。

## 2. 目标与非目标

### 2.1 目标

- 使用单代码库支持双平台部署
- 共享核心代理与清洗逻辑，避免重复实现
- 保持统一外部接口：`/claude/{host}/v1/messages`
- 让 EO Pages 具备生产级一等公民支持
- 为双平台建立一致的测试与文档

### 2.2 非目标

- 不引入 dashboard、metrics 面板或运营后台
- 不引入 provider registry 或多租户能力
- 不支持第三个平台
- 不在本次设计中扩展非 `v1/messages` 的新 API 形态

## 3. 关键约束

- 用户明确要求采用 `单核心逻辑 + 双平台薄适配`
- 用户明确要求两个平台对外接口完全一致
- 用户明确要求 EO 支持达到生产级，而不是实验性质
- 现有仓库规模较小，应优先使用 KISS、DRY、YAGNI，避免过度抽象

## 4. 方案对比

### 方案 A：纯核心 + 双入口薄适配

将核心请求处理、重试、清洗与路由逻辑抽离为平台无关层，只为 Cloudflare 和 EO 分别保留一层很薄的入口适配器。

优点：

- 复用度最高
- 平台边界清晰
- 后续新增平台时只需增加适配层

缺点：

- 需要一次结构化重构
- 需要补齐双平台文档和测试

结论：推荐。

### 方案 B：在现有模块内嵌平台判断

保留当前目录，直接在业务模块里添加 `platform` 分支兼容 EO。

优点：

- 初期改动较少

缺点：

- 平台分支会渗透进核心逻辑
- 长期维护成本高
- 容易破坏单一职责

结论：不推荐。

### 方案 C：双产物构建，共享较粗的主实现

通过不同构建入口产出两个平台版本，共享部分实现，但仍保留较多平台差异代码。

优点：

- 比方案 B 干净

缺点：

- 构建复杂度上升
- 平台差异仍会逐步侵入核心层

结论：可作为过渡，但不适合当前目标。

## 5. 最终设计决策

采用方案 A：

- 共享核心处理逻辑
- 提供 Cloudflare 和 EO 两套薄适配入口
- 统一外部 API 契约
- EO 优先采用 Node.js Functions，而不是 Edge Functions

选择 EO Node.js Functions 的原因：

- 该项目是代理型服务，请求体和运行时间约束比纯边缘轻逻辑更敏感
- EO Edge Functions 的官方限制更紧，请求 body 仅支持 `1 MB`，CPU 时间 `200 ms`
- EO Node.js Functions 更适合 API 服务和原生 `Request/Response` 风格处理

## 6. 目标架构

建议拆成三层：

1. 平台入口层
2. 平台无关核心层
3. 平台能力适配层

职责划分如下：

- 平台入口层：
  - 接收平台原生请求
  - 转为统一上下文
  - 将核心返回的 `Response` 返回给平台

- 核心层：
  - 处理 `/`、`/health`
  - 解析 `/claude/{host}/{path}`
  - 校验是否允许代理
  - 转发请求
  - 执行 orphan cleanup 与 retry

- 平台能力适配层：
  - 抽取平台上下文
  - 统一环境变量读取方式
  - 暴露可选的 `waitUntil`
  - 屏蔽入口模型差异

## 7. 建议目录结构

```text
src/
  core/
    app.ts
    routes.ts
    proxy.ts
    retry-handler.ts
    proactive-cleanup.ts
    error-detector.ts
    streaming-handler.ts
    types.ts

  adapters/
    cloudflare/
      entry.ts
      context.ts
    edgeone/
      entry.ts
      context.ts

  shared/
    response.ts
    request-id.ts

cloud-functions/
  index.ts
  [[default]].ts

wrangler.jsonc
edgeone.json
package.json
tsconfig.json
```

设计说明：

- `src/core/*` 仅保留平台无关逻辑
- `src/adapters/cloudflare/*` 适配 Cloudflare `fetch(request, env, ctx)`
- `src/adapters/edgeone/*` 适配 EO `onRequest(context)`
- `cloud-functions/index.ts` 负责根路径 `/`
- `cloud-functions/[[default]].ts` 负责 `/health`、`/claude/...` 以及其他非根路径
- 已通过当前仓库内的 `edgeone pages init` 实际验证，EO CLI 在本仓库使用 `cloud-functions/`

## 8. 统一上下文模型

核心层只依赖一个很薄的上下文接口：

```ts
interface AppContext {
  request: Request;
  platform: 'cloudflare' | 'edgeone';
  env: Record<string, string | undefined>;
  waitUntil?: (promise: Promise<unknown>) => void;
}
```

设计原则：

- `request` 继续直接使用 Web 标准对象
- `platform` 仅用于极少量元信息场景，不默认进入业务分支
- `env` 统一成最薄的键值访问方式
- `waitUntil` 设为可选，避免核心强耦合到特定平台

核心主入口建议统一为：

```ts
handleRequest(appContext: AppContext): Promise<Response>
```

## 9. 统一请求流

双平台请求都走同一条核心链路：

1. 平台入口接收请求
2. 适配器将平台上下文映射为 `AppContext`
3. 核心层处理 `/` 与 `/health`
4. 核心层解析 `/claude/{host}/{path}`
5. 核心层校验路径与目标 host
6. `proxy` 组装上游请求
7. 若 body 为 JSON 且包含 `messages`，进入 cleanup + retry 流程
8. 返回标准 `Response`

`retry-handler`、`proactive-cleanup`、`error-detector`、`streaming-handler` 不应感知运行平台。

## 10. 环境变量策略

本次只保留最小必要配置：

### 10.1 `ALLOWED_TARGET_HOSTS`

- 作用：限制允许代理的上游主机白名单
- 格式：逗号分隔
- 结论：建议在生产环境配置；未配置时默认允许全部目标

原因：

- 当前实现从行为上看接近开放代理
- 迁移到双平台并公开部署后，风险会被放大

### 10.2 `DEBUG_REQUEST_LOGS`

- 作用：开启最小调试日志
- 默认：关闭

### 10.3 明确不做的配置

本次不引入：

- provider registry
- 多环境配置工厂
- 路由规则中心
- 平台专属配置映射器

这些都超出当前规模，属于过度设计。

## 11. 错误处理设计

统一错误语义如下：

- `400`
  - 路由格式非法
  - 例如不符合 `/claude/{host}/{path}`

- `403`
  - 路由命中但目标不允许
  - 例如不包含 `v1/messages`
  - 或目标 host 不在 `ALLOWED_TARGET_HOSTS` 中

- `502`
  - 上游请求失败
  - 平台入口异常
  - 运行时内部错误

- `400 -> retry once`
  - 仅针对 orphaned `tool_result` 场景保留一次补偿重试

安全约束：

- 不向客户端暴露内部栈信息
- 平台适配层不吞业务错误
- 核心层不关心平台入口异常细节，只输出稳定 `Response`

## 12. 测试策略

必须建立三层测试：

### 12.1 核心单元测试

覆盖：

- 路由解析
- host/path 校验
- orphan cleanup
- retry 决策
- 流式响应识别

### 12.2 平台适配测试

分别验证：

- Cloudflare adapter 是否正确映射请求、环境变量和可选 `waitUntil`
- EO adapter 是否正确映射 `context.request`、`context.env` 和元信息

### 12.3 跨平台契约测试

对同一组 fixture：

- 同时喂给 Cloudflare adapter 和 EO adapter
- 断言状态码一致
- 断言关键响应头一致
- 断言响应体语义一致
- 断言流式与非流式路径行为一致

这是防止“双平台支持”演变成“双分叉实现”的关键测试层。

## 13. 本地开发与部署策略

不强行统一底层 CLI，只统一代码结构、环境变量名和文档结构。

### 13.1 Cloudflare

- 本地开发：`wrangler dev`
- 部署：`wrangler deploy`

### 13.2 EO

- 本地开发：`edgeone pages dev`
- 部署：`edgeone pages deploy`

### 13.3 设计理由

- 两个平台原生工具链不同
- 为了统一命令而额外封装 orchestration 收益低
- `KISS` 原则下，更合理的是统一核心逻辑与测试，而不是强行统一底层 CLI

## 14. 风险与待验证项

### 14.1 EO 官方目录命名口径不一致

设计确认后，在当前仓库中做了实际验证，结果如下：

- 腾讯云 `Node.js` 文档使用的是 `/cloud-functions` 目录约定
- `EdgeOne CLI` 文档写初始化时会生成 `node-functions` 或 `edge-functions`
- 当前 CLI 在本仓库内实际生成的是 `cloud-functions/`

这说明文档口径存在不一致，但本仓库已可按实测结果落地。

处理策略：

- 以当前 CLI 实际生成结果为准
- 本仓库固定使用 `cloud-functions/`

### 14.2 EO 运行时选择风险

EO 同时提供 Node.js Functions 与 Edge Functions。

本设计明确选择 Node.js Functions，原因是：

- Edge Functions 官方限制为 `1 MB` 请求 body 和 `200 ms` CPU 时间
- 当前代理服务更接近 API 网关场景，不适合落在更紧的边缘函数约束上

### 14.3 开放代理风险

如果不增加 host 白名单，双平台部署后都存在被滥用的可能。

因此 `ALLOWED_TARGET_HOSTS` 必须纳入首批实现范围。

## 15. 验收标准

满足以下条件可视为设计成功落地：

- Cloudflare 与 EO 均可处理 `/`、`/health`、`/claude/{host}/v1/messages`
- 两个平台行为一致，客户端无需变更调用方式
- orphan `tool_result` 清洗与重试逻辑只保留一份实现
- 双平台拥有独立入口，但核心逻辑无平台分支污染
- 存在核心测试、平台适配测试、跨平台契约测试
- README 或补充文档清晰描述双平台本地开发与部署方式
- 默认不形成开放代理

## 16. 实施边界

本次实现只覆盖：

1. 双平台共享核心逻辑
2. Cloudflare 与 EO 入口适配
3. 生产级最小配置与安全约束
4. 双平台测试与文档

明确不覆盖：

1. 监控面板
2. 统计分析
3. Provider 扩展框架
4. 多租户与高级配置系统
5. 第三个平台

## 17. 参考资料

- 腾讯云 EO 构建指南
  - https://cloud.tencent.com/document/product/1552/127392
- 腾讯云 EO Node.js
  - https://cloud.tencent.com/document/product/1552/127419
- 腾讯云 EO Edge Functions
  - https://cloud.tencent.com/document/product/1552/127416
- EdgeOne CLI
  - https://edgeone.cloud.tencent.com/pages/document/162936923278893056

## 18. 设计结论

该项目可以接入 EO，但不适合直接把现有 Cloudflare Worker 代码原样部署到 EO。

正确做法是：

- 保留单份核心逻辑
- 为 Cloudflare 和 EO 分别建立薄适配入口
- 统一外部 API
- 使用 EO Node.js Functions 作为正式承载形态
- 在实现前验证 EO 当前版本真实的函数目录约定

这条路径最符合当前仓库规模，也最符合 SOLID、KISS、DRY、YAGNI。
