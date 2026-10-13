-- 当前阶段统一以 V1 表示已发布并入账的基础可用成果。
-- 后续由 AI 应用官按复用证据逐项调整为 V2。
update public.assets
set verification_level = 'V1'
where verification_level is distinct from 'V1';
