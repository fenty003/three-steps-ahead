# 架构与实现

面向要改代码、改协议或迁移到别的宿主的人。用法看 [README](../README.md)，项目经验看 `D:\ULW\Learning\ThreeStepsAhead_意图回读_交接手册.md`。

## 1. 三层结构

| 层 | 载体 | 职责 |
| --- | --- | --- |
| 内容层 | `SKILL.md` | **唯一权威**：回读协议的全部行为规则 |
| 分发层 | 手动拷贝 / npm 包 | 把内容送进宿主的两种方式 |
| 宿主层 | DSH 的 `SkillRegistry`（服务名 `skills`） | 存技能、按调用策略加载、渲染给模型 |

关键约定：**插件不复制 `SKILL.md` 的内容**，启动时读文件再注册。所以协议只有一份，改 `SKILL.md` 就等于改行为。

## 2. `SKILL.md` 规格

### frontmatter

```yaml
name: three-steps-ahead        # 必须与 package.json 的 name 一致，smoke 会检查
description: "……"              # 决定宿主何时自动加载，也是市场页面上的一行简介
```

插件读的正是这两个字段：`name` 用于注册，`description` 用于匹配。

### 标记语法 `%% … %%`

| 规则 | 说明 |
| --- | --- |
| 成对 | 第 1 个 `%%` 开、第 2 个闭，按出现顺序配对 |
| 多段 | 一条消息可框 N 段，按顺序编号 |
| 全角 | `％％` 等价 |
| 空框 | `%%%%` 直接忽略 |
| 奇数个 | 不猜，先问一句结尾在哪 |
| 嵌套 | **不支持**，`%%外层 %%内层%% %%` 会被拆成两段 |
| 无标记 | 完全不做回读 |

标记必须满足四条：免切输入法、正文不出现、不撞 markdown、不撞 shell。`^`（中文 IME 是 `……`）、`??`（中文高频表达困惑）、`~~`（删除线）、`@`（提及菜单）、`&&`（shell）全部被这条过滤掉。

### 四张卡

一段一组、一组一次调用、四个问题（宿主单次调用上限就是 4）：

| # | header | 问什么 | 选项 |
| --- | --- | --- | --- |
| 1 | 你要的 | 目的，一句话 | 对 / 不对，我改 |
| 2 | 我要做的 | 可数的动作 | 对 / 不对，我改 |
| 3 | 预期结果 | 可验证的结果 | 对 / 不对，我改 |
| 4 | 补充说明 | 开放项，留给用户 | 没有补充 / 我要补一句 |

多段时**逐段串行**（上一段收齐才发下一段），因为 2 段并发 = 8 个问题，超上限。框超过 4 段先问要不要合并。

`custom` 字段（界面自带的输入框）回传的文字**直接当用户要求采用**，不再反问"你指的是什么"。

## 3. 插件实现

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `package.json` | `main`、`exports`、`files` 白名单、`dsh.bundle.patch` 指向 patch 文件 |
| `cordis.patch.yml` | 声明挂载：`- insert: [{id, name}]` |
| `lib/index.js` | 读 `SKILL.md`、解析 frontmatter、`ctx.skills.register()` |
| `scripts/smoke.mjs` | 不依赖宿主的 15 项验证（不进发布包，`files` 里没有它） |
| `SKILL.md` | 协议正文 |

### 加载链路

```
profile/package.json (dependencies)
  → dsh.profile.bundles  ← 两处都由 `dsh plugin add` 自动写入，无需手改
  → cordis.patch.yml 的 insert
  → apply(ctx)
      → ctx.inject(['skills'], scoped => …)
          → scoped.get('skills').register({ name, description, content })
```

`register()` 返回 disposer，包在 `scoped.effect()` 里，插件卸载时技能自动消失。

### 三个刻意的设计选择

1. **运行时读文件，不内联正文**。否则改协议要改两处，必然漂移。
2. **零依赖、不声明 `peerDependencies`**。不 import 任何 `@deepseek-ai/*`，就不存在"peer 版本范围不匹配导致整个 profile 装不上"的风险（交接手册里记着别家插件踩过）。
3. **`apply` 不外抛异常**。文件读不到、服务缺失、frontmatter 缺字段，一律降级为一条警告，不拖垮宿主启动。

### 失败模式

| 情况 | 表现 | 处理 |
| --- | --- | --- |
| `SKILL.md` 读不到 | 技能不注册 | 打一条 warn |
| `skills` 服务缺失 | 技能不注册 | 打一条 warn |
| frontmatter 缺 `name`/`description` | 技能不注册 | 打一条 warn 并列出缺哪项 |
| 与手动拷贝的同名技能并存 | 宿主按 project > runtime > user 取用，日志有重名警告 | 行为一致，删掉手动那份即可 |

## 4. 三道验证

| # | 验什么 | 怎么做 |
| --- | --- | --- |
| 1 | 注册逻辑 | `node scripts/smoke.mjs` → 15 项，用假 ctx 抓 `register` 的实参 |
| 2 | 分发链路 | `pnpm --dir <临时目录> add github:fenty003/three-steps-ahead` |
| 3 | 真机挂载 | `dsh plugin --profile desktop add github:fenty003/three-steps-ahead` → **重启客户端** → 技能清单出现 `three-steps-ahead` |

第 2 步需要起 `git` 子进程，在本机沙箱下会 `spawn EPERM`，要提权跑一次。
第 3 步注意：`dsh --profile desktop --dump-config` 会被拒（desktop profile 由 Electron 独占），**重启前没有别的办法验证挂载**，只能重启后看清单。

**2026-10-29 验收记录**：三道全过。`dsh plugin add` 后 `profile/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 都自动写入了该项；重启后技能清单里出现 `three-steps-ahead`。

## 5. 已知边界

- 一次调用只能问 4 个问题 ⇒ 多段必须串行，框 3 段 = 3 轮 12 张卡。
- 不支持嵌套框段。
- 插件是 host-only，没有 UI 半区（不需要，也没有 client 注入）。
- 纯 `SKILL.md` 仓库进不了 DSH 插件市场：市场 7406 条里 `category:"skill"` 的 269 条**全是插件包**，收录靠人工 PR。

## 6. 改协议的同步清单

改 `SKILL.md` 的行为时，这四处必须一起动，否则说法会打架：

1. `SKILL.md`（权威）
2. `C:\Users\1078694552\.dsh\skills\three-steps-ahead\SKILL.md`（本机已装副本）
3. `C:\Users\1078694552\.dsh\AGENTS.md`（常驻规则里的压缩版契约）
4. `README.md`（面向用户的说明）

改完跑 `node scripts/smoke.mjs`；若改了 `name`，同步改 `package.json` 与 `cordis.patch.yml` 的 `id`。
