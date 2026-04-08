# BetterClaude 三平台部署设计（增加阿里云 ESA）

- 日期：2026-04-08
- 主题：在现有 Cloudflare Workers + 腾讯云 EO Pages 基础上增加阿里云 ESA Functions & Pages 支持
- 状态：设计已确认，待写实现计划

## 1. 背景

当前仓库已经完成双平台支持：

- Cloudflare Workers
- 腾讯云 EO Pages

核心能力保持一致：

- 代理 `/claude/{host}/v1/messages`
- 提供 `/` 与 `/health`
- 支持 orphaned `tool_result` 的主动清理和一次补偿重试
- 通过 `ALLOWED_TARGET_HOSTS` 控制上游目标白名单

当前实现已经形成清晰边界：

- 共享逻辑位于 [`src/core/`](../../../src/core)
- 平台适配位于 [`src/adapters/cloudflare/`](../../../src/adapters/cloudflare) 与 [`src/adapters/edgeone/`](../../../src/adapters/edgeone)
- 平台入口只负责上下文翻译，不参与核心代理逻辑

本次目标是在不破坏现有双平台结构的前提下，新增阿里云 ESA 作为第三个平台。

## 2. 用户确认的约束

本次设计以用户明确确认的约束为准：

- 目标是三平台一等支持：Cloudflare、EdgeOne、阿里云 ESA
- 平台对外行为保持一致
- 部署配置允许分平台
- ESA 希望采用与 EdgeOne 类似的产品形态，即 Functions & Pages + 自定义域名直连
- ESA 需要支持本地 CLI 直接完成 `init / dev / commit / deploy`
- ESA CLI 不纳入 `package.json` 脚本，使用 README 中约定的 `npx esa-cli ...` 工作流
- 本轮 ESA 验收级别为“运行 + 发布一等支持”，不要求把 ESA 自动化测试做到一等公民

## 3. 目标与非目标

### 3.1 目标

- 在单代码库内新增阿里云 ESA 运行时适配
- 保持三个平台一致的外部 API 契约：
  - `/`
  - `/health`
  - `/claude/{host}/v1/messages`
- 保持统一环境变量语义：
  - `ALLOWED_TARGET_HOSTS`
  - `DEBUG_REQUEST_LOGS`
- 让 ESA 具备仓库内可落地的本地调试和发布路径
- 在 README 中提供完整 ESA 部署教程和故障排查说明

### 3.2 非目标

- 本轮不引入第四个平台抽象层
- 本轮不重写 `src/core/*`
- 本轮不将 ESA CLI 作为项目依赖或 `package.json` 脚本
- 本轮不要求补齐 ESA 自动化测试的一等支持
- 本轮不接入 ESA 的旁路路由模式
- 本轮不扩展新的代理 API 形态，仍只支持 `v1/messages`

## 4. 官方能力与设计前提

结合阿里云 ESA 官方文档，本次设计建立在以下前提上：

- ESA 提供 Functions & Pages CLI，支持 `init`、`dev`、`commit`、`deploy`、`domain`、`route` 等完整生命周期命令  
  参考：[函数和Pages CLI工具](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)

- ESA 支持通过 CLI 创建 Pages 并绑定自定义域名  
  参考：[使用CLI创建Pages并绑定自定义域名](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/create-pages-by-cli)

- ESA Pages 使用 `esa.jsonc` 管理构建与入口，支持声明 `entry` 以及可选静态资源目录  
  参考：[管理Pages构建和路由](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)

- ESA 运行时支持标准 Web API，并支持 `process.env`  
  参考：[函数运行时环境支持的API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/runtimeapi-manual)

- ESA 提供基于域名和路由的触发方式，但路由旁路模式会改变请求/响应语义，不适合本项目  
  参考：[为函数和Pages配置自定义访问路径](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/trigger)

设计中的一条明确推断：

- 我查阅的 ESA Runtime API 文档中没有像 Cloudflare `ExecutionContext` 或 EO `waitUntil` 那样明确展示等价能力，因此 ESA adapter 设计中将 `waitUntil` 视为可选能力；若实现阶段确认存在官方等价 API，再接入，否则保持 `undefined`。这是基于官方文档可见信息作出的保守推断。

## 5. 方案对比

### 方案 A：继续沿用“共享 core + 平台薄适配”

只新增 ESA adapter、ESA 入口文件、`esa.jsonc` 与 README 工作流，核心代理逻辑继续复用 [`src/core/`](../../../src/core)。

优点：

- 与当前双平台结构完全一致
- 风险最小
- 不会扰动已经验证过的 Cloudflare / EdgeOne 行为
- 平台边界仍然清晰

缺点：

- 平台接入数量增加后，入口文件和文档会继续变多

结论：推荐。

### 方案 B：再抽一层“统一 Pages 平台基座”

把 EdgeOne 与 ESA 再向上抽象成一个共享的 Pages 平台层。

优点：

- 理论上更规整
- 未来接入更多 Pages 类平台时可以复用

缺点：

- 当前收益不足以覆盖重构成本
- 会重新扰动已稳定的 EdgeOne 路径
- 容易演化出为抽象而抽象的结构

结论：本轮不推荐。

### 方案 C：单独做一套 ESA 分叉实现

为 ESA 新建一组独立实现，尽量少碰现有结构。

优点：

- 实现隔离
- 初期思考负担低

缺点：

- 共享逻辑会重复
- 后续修复和迭代需要三处同步
- 明显违背当前仓库已经形成的 DRY 方向

结论：不推荐。

## 6. 最终设计决策

采用方案 A：

- 继续保留共享 core
- 增加 ESA 平台薄适配
- 部署配置分平台维护
- 用户侧 API 和环境变量保持一致
- ESA 采用 Functions & Pages + 自定义域名直连形态
- ESA 不走旁路路由模式

原因如下：

- 这是与当前 EdgeOne 形态最接近的接入方式
- 符合用户选择的“行为一致、部署分平台”
- 可以最大程度复用现有双平台结构
- 不会把 ESA 特殊行为侵入共享 core

## 7. 目标架构

三平台统一后，项目仍保持三层：

1. 平台入口层
2. 平台上下文适配层
3. 平台无关核心层

职责划分如下：

- 平台入口层：
  - 接收平台原生请求
  - 获取平台环境变量
  - 调用对应 adapter 入口

- 平台上下文适配层：
  - 把平台原生对象转成统一 `AppContext`
  - 屏蔽 `env`、`request`、`waitUntil` 的差异

- 核心层：
  - 处理 `/`、`/health`
  - 解析 `/claude/{host}/{path}`
  - 校验目标白名单
  - 执行代理、清理、重试

## 8. 统一上下文模型

共享核心继续只依赖一个最薄的上下文接口：

```ts
interface AppContext {
  request: Request;
  platform: 'cloudflare' | 'edgeone' | 'esa';
  env: Record<string, string | undefined>;
  waitUntil?: (promise: Promise<unknown>) => void;
}
```

关键设计约束：

- `platform` 只用于元信息，不默认引入业务分支
- `env` 统一成字符串键值对，避免平台 API 外溢
- `waitUntil` 对 ESA 保持可选
- 共享 core 不感知 `esa.jsonc`、EO 函数目录、Wrangler 配置等部署细节

## 9. 建议目录增量

在现有仓库基础上新增：

```text
src/
  adapters/
    esa/
      context.ts
      entry.ts

  esa.ts

esa.jsonc
```

说明：

- `src/adapters/esa/context.ts`
  - 负责把 ESA 原生上下文转成 `AppContext`

- `src/adapters/esa/entry.ts`
  - 负责调用 `handleRequest(createEsaAppContext(...), { proxyRequest })`

- `src/esa.ts`
  - 作为 ESA Pages 入口文件
  - 只承载平台入口职责

- `esa.jsonc`
  - 作为 ESA Pages 平台配置
  - 只描述 ESA 部署层信息

本轮不新增：

- `package.json` 中的 ESA 脚本
- 新的共享抽象层
- ESA 专用核心逻辑目录

## 10. ESA 入口与配置设计

### 10.1 ESA 入口

ESA 平台入口职责应与现有 Cloudflare / EO 一致：

- 接收平台请求
- 从 `process.env` 读取环境变量
- 构造 `AppContext`
- 调用共享 `handleRequest`
- 返回 `Response`

入口层应保留最小异常兜底，防止平台运行时异常裸崩，但不在入口层复制业务错误处理逻辑。

### 10.2 ESA 配置

`esa.jsonc` 的设计原则：

- 明确声明函数入口文件
- 不把 ESA 配置混入 `wrangler.jsonc` 或 EO 配置
- 不为当前纯 API 项目引入额外静态页面职责

当前项目是 API 网关，不需要静态首页。因此 ESA 配置应以函数入口为主，静态资源目录不是核心契约的一部分。

实现阶段建议：

- 优先采用仅声明 `entry` 的最小可运行配置
- 如果 ESA Pages 本地工作流强依赖静态资源目录，再选择一个不会污染 API 行为的最小目录配置

这条是实现建议，不改变本设计的核心决策：ESA 入口必须由函数返回 `/` 与 `/health`，而不是由静态页面兜底。

## 11. 为什么不走 ESA 旁路模式

本项目不能使用 ESA 的路由旁路模式，原因是它会破坏当前代理语义。

根据官方文档，在路由旁路模式下：

- 原请求体不会被传递给函数
- 如果函数返回 `200`，请求会继续后续处理
- 如果函数返回非 `200`，ESA 会直接向客户端返回 `403`

这与本项目的需求明显冲突：

- `/claude/{host}/v1/messages` 需要完整请求体
- 代理返回状态码必须由上游响应决定，而不是被平台强制改写
- `/`、`/health`、非法路径等语义必须由项目自身决定

因此 ESA 必须采用：

- Pages 自定义域名直连
- 函数作为主处理入口

而不是：

- 基于 ESA 站点路由的旁路触发

## 12. README 与本地工作流设计

README 中需要新增完整 ESA 教程，但不新增 `package.json` 脚本。

文档应覆盖：

- `npx esa-cli login`
- `npx esa-cli init`
- `npx esa-cli dev`
- `npx esa-cli commit`
- `npx esa-cli deploy`
- 自定义域名绑定与验证

同时明确：

- 仓库不内置 ESA CLI 脚本
- 使用者按 README 直接执行 `npx esa-cli ...`
- ESA 的环境变量语义与其他平台保持一致

## 13. 验收范围

本轮 ESA 完成的最低验收标准是：

- 仓库存在 ESA 入口文件和 `esa.jsonc`
- ESA 本地可启动调试
- ESA 可完成版本提交与线上部署
- ESA 可绑定自定义域名
- 自定义域名下行为与 Cloudflare / EdgeOne 一致：
  - `/` -> `200`
  - `/health` -> `200`
  - `/claude/{host}/v1/messages` -> 正常代理
  - 非法路径 -> 保持当前错误语义
- README 提供完整 ESA 使用说明和排障说明

本轮不作为硬验收项：

- ESA adapter 自动化测试
- `package.json` 脚本集成
- 更高层通用 Pages 平台抽象

## 14. 风险与缓解

### 风险 1：ESA 入口模型与 Cloudflare/EO 存在细节差异

缓解：

- 通过独立 ESA adapter 吸收差异
- 不让平台细节进入 `src/core/*`

### 风险 2：ESA CLI/配置字段与预期存在偏差

缓解：

- 先以最小可运行配置为目标
- README 只写经实际验证过的命令

### 风险 3：误走旁路模式导致代理语义被平台改写

缓解：

- 在设计、实现、README 中都明确禁止该模式

### 风险 4：为追求表面统一而引入过度抽象

缓解：

- 本轮严格限定为薄适配
- 不新增“统一 Pages 基座”

## 15. 实现边界总结

本次 ESA 接入的本质是：

- 增加第三个平台入口
- 维持统一核心逻辑
- 允许部署配置分平台
- 把本地 CLI 工作流写入文档

而不是：

- 改写现有核心代理实现
- 把 ESA 特性反向污染 Cloudflare / EO
- 做额外的平台抽象工程

## 16. 参考资料

- [函数和Pages CLI工具](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/functions-and-pages-cli-tool)
- [使用CLI创建Pages并绑定自定义域名](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/create-pages-by-cli)
- [管理Pages构建和路由](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/build-pages)
- [函数运行时环境支持的API](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/runtimeapi-manual)
- [为函数和Pages配置自定义访问路径](https://help.aliyun.com/zh/edge-security-acceleration/esa/user-guide/trigger)
