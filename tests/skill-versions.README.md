# 本地版本流程测试

`skill-versions.fixture.sql` 建立最小测试表与五种角色数据；只能用于新建的一次性本地数据库，禁止对正式库执行。

在一次性本地 PostgreSQL 数据库中依次执行：

1. `tests/skill-versions.fixture.sql`
2. `migrations/20261121_skill_versions.sql`
3. `tests/skill-versions.flow.sql`

用 `psql -v ON_ERROR_STOP=1` 执行。最后应打印 PASS；任何失败都要停止。fixture 的台账触发器是简化桩，测试用于确认同一个成果记录发布时只更新原台账；正式环境已有台账触发器仍需联调验收。
