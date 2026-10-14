-- 任务更新保留客户端业务修改时间，供跨设备 LWW 合并。
DROP TRIGGER IF EXISTS trg_tasks_updated_at ON public.tasks;
