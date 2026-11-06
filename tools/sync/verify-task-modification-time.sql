BEGIN;

DO $$
DECLARE
    test_id uuid := gen_random_uuid();
    test_user_id uuid;
    saved_at timestamptz;
    affected_rows integer;
    saved_title text;
BEGIN
    SELECT user_id INTO STRICT test_user_id FROM public.tasks LIMIT 1;
    INSERT INTO public.tasks (id, user_id, title, updated_at)
    VALUES (test_id, test_user_id, '同步验证', '2026-10-13T09:00:00Z');

    UPDATE public.tasks SET title = '第一次修改', updated_at = '2026-10-13T10:00:00Z'
    WHERE id = test_id AND updated_at <= '2026-10-13T10:00:00Z'
    RETURNING updated_at INTO saved_at;
    ASSERT saved_at = '2026-10-13T10:00:00Z'::timestamptz, '首次修改时间未保留';

    UPDATE public.tasks SET title = '最新修改', updated_at = '2026-10-13T10:05:00Z'
    WHERE id = test_id AND updated_at <= '2026-10-13T10:05:00Z';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    ASSERT affected_rows = 1, '后续离线修改未写入';

    UPDATE public.tasks SET title = '最新修改', updated_at = '2026-10-13T10:05:00Z'
    WHERE id = test_id AND updated_at <= '2026-10-13T10:05:00Z'
    RETURNING updated_at INTO saved_at;
    ASSERT saved_at = '2026-10-13T10:05:00Z'::timestamptz, '重复发送改写了修改时间';

    UPDATE public.tasks SET title = '过期修改', updated_at = '2026-10-13T09:00:00Z'
    WHERE id = test_id AND updated_at <= '2026-10-13T09:00:00Z';
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    ASSERT affected_rows = 0, '过期版本覆盖了最新修改';

    SELECT title INTO saved_title FROM public.tasks WHERE id = test_id;
    ASSERT saved_title = '最新修改', '最终状态与最新修改不一致';
END;
$$;

ROLLBACK;

SELECT NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'trg_tasks_updated_at'
) AS preserves_client_modification_time;
