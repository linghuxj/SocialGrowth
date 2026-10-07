---
status: accepted
---

# 中心业务后端采用 NestJS

2026-09-28，用户在中心业务后端框架对齐中选择 A：在已确认的 TypeScript＋Node.js 基础上采用 NestJS，组织模块化单体业务后端。项目、设备、任务、权限及基础分佣等模块通过明确依赖共享业务规则；相比直接使用 Fastify 自行组织应用，选择 NestJS 的模块、依赖注入和统一请求处理结构，代价是遵循框架约定并维护相应结构代码。

本决策只确定中心业务后端框架。HTTP 底层采用 Express 或 Fastify、数据访问组件、正式依赖版本及后台作业进程划分在对应实现时落实；Web 前端后续已按 [ADR-0010](0010-react-typescript-vite-operations-web.md) 确认为 React＋TypeScript＋Vite。NestJS 的模块划分不改变既定业务集中组织与 Artemis 独立执行边界，也不自动引入微服务、CQRS 或事件溯源；鉴权、事务一致性、队列恢复与实际动作许可仍须由实现和验证保障。
