---
name: qq-official-bot-dev-workflow
description: "qq-official-bot 专用开发流程技能。用于 TypeScript 报错修复、功能开发、模块重构、导出调整与文档同步。包含定位问题、最小改动实现、pnpm 编译构建验证、风险说明与交付清单。"
argument-hint: "描述目标、报错信息、涉及模块或期望行为"
user-invocable: true
---

# qq-official-bot Development Workflow

## Skill Outcome

产出一套可复用的端到端开发执行流程，适用于本仓库常见任务：
- TypeScript 编译错误修复
- 小到中等范围功能开发
- 模块级重构与导出调整
- 行为变更后的文档同步

## When to Use

在以下场景优先使用本技能：
- 用户提供了 TS 报错、构建失败或行为异常
- 需要在不扩大改动范围的前提下实现需求
- 需要统一执行 compile/build 验证并给出结果
- 需要判断是否同步更新文档

不适用场景：
- 仅闲聊或纯概念讨论
- 与本仓库无关的泛化问题

## Repository Rules

- 代码真源在 [src](../../src)
- [lib](../../lib) 是构建产物，不直接做功能修复
- 变更后验证命令优先使用 pnpm
- 文档真源在 [docs/src](../../docs/src)
- 项目级行为约定见 [AGENTS.md](../../AGENTS.md)

## Procedure

1. 明确目标与边界
- 提取用户目标、失败信号、约束条件。
- 将任务限定到必要模块，避免无关重构。

2. 收集上下文
- 阅读目标文件与邻近类型/调用点。
- 搜索同类实现，确认本仓库既有模式。

3. 设计最小改动
- 优先选择局部补丁，不改公共行为。
- 如需改导出，连同 index barrel 一并核对。

4. 实施修改
- 仅改必要文件，优先位于 [src](../../src)。
- 保持现有代码风格与模块边界。

5. 验证
- 代码改动后按顺序执行：
  1. pnpm run compile
  2. pnpm run build
- 若失败：继续修复直到通过，或明确说明阻塞点与替代方案。

6. 文档决策分支
- 如果变更影响 API 或开发者可见行为：同步更新 [docs/src](../../docs/src) 对应文档。
- 如果仅为内部重构且无行为变化：可不更新文档，但需在结果中声明原因。

7. 交付结果
- 输出修复/实现摘要、文件清单、验证结果、风险与后续建议。

## Decision Points

- 是否允许扩大范围：默认否，除非最小方案无法成立。
- 是否修改 public API：默认否，除非需求明确要求。
- 是否更新文档：以行为或接口变化为判断标准。

## Quality Gates

完成前必须满足：
- 改动与需求直接相关
- 未手工修改 [lib](../../lib) 功能逻辑
- compile 与 build 已执行，结果已报告
- 若有行为变化，文档已同步或已说明不需要同步

## Common Pitfalls

- 只修表层报错，忽略同链路类型影响
- 直接在产物目录修复导致后续回归
- 变更导出后未同步检查入口与 barrel
- 将环境警告误判为业务代码错误

## Suggested Output Template

1. Solution
2. Files Changed
3. Validation
4. Risks
5. Next Steps
