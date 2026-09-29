---
status: accepted
---

# 中心业务后端采用 TypeScript 与 Node.js

2026-09-28，用户在中心业务后端语言与运行时对齐中选择 A：正式中心业务后端使用 TypeScript 与 Node.js，承载已确认的模块化业务规则。相比改用 Python 业务后端，此选择便于复用现有 TypeScript 工具及适合的接口类型，但不自动继承 Demo 的业务模型；跨进程输入仍须运行时校验，静态类型不能代替权限、业务与数据校验。

Artemis 保持独立执行，既有 Python 引擎不因本决策改写；中心与执行端须维护明确的任务和回执接口。后端框架后续已按 [ADR-0009](0009-nestjs-central-business-backend.md) 确认为 NestJS；Web 技术栈后续已按 [ADR-0010](0010-react-typescript-vite-operations-web.md) 确认；正式依赖版本、数据访问组件及后台作业进程划分另行落实；本次只确认语言与运行时，不开始搭建或迁移实现，也不改变操作现有仓库时的环境规范。
