import type { Task } from '../types';
import { parseMarkdownDocument } from './markdown-syntax';

/** 笔记中某个正式任务的引用位置。 */
export interface TaskReference {
  taskId: string;
  notePath: string;
  line: number;
  lineStart: number;
  lineEnd: number;
  title: string;
  completed: boolean;
  indent: string;
  marker: '-' | '*' | '+';
}

/** 一个笔记文件的任务引用索引。 */
export interface TaskReferenceIndex {
  byTaskId: Map<string, TaskReference[]>;
  byNotePath: Map<string, TaskReference[]>;
}

const TASK_REFERENCE_PATTERN =
  /^(\s*)([-*+])\s+\[([ xX])\]\s+(.*?)\s*<!--\s*prism-task:([A-Za-z0-9_-]+)\s*-->\s*$/;

/**
 * 解析 Markdown 中带有稳定任务 ID 的任务引用。
 * 只识别 Prism 生成的任务行，不会把普通 Markdown 复选框误当成正式任务。
 */
export function parseTaskReferences(markdown: string, notePath: string): TaskReference[] {
  const references: TaskReference[] = [];
  const { tree, toSourceOffset } = parseMarkdownDocument(markdown);
  const taskRanges: { from: number; to: number; comments: { from: number; to: number }[] }[] = [];
  const visit = (node: typeof tree.topNode) => {
    if (node.name === 'Task') {
      const comments: { from: number; to: number }[] = [];
      const findComments = (taskNode: typeof tree.topNode) => {
        for (let child = taskNode.firstChild; child; child = child.nextSibling) {
          if (child.name === 'Comment')
            comments.push({ from: toSourceOffset(child.from), to: toSourceOffset(child.to) });
          findComments(child);
        }
      };
      findComments(node);
      taskRanges.push({ from: toSourceOffset(node.from), to: toSourceOffset(node.to), comments });
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  };
  visit(tree.topNode);
  const lines = markdown.split(/\r?\n/);
  let offset = 0;

  lines.forEach((line, index) => {
    const lineEndingLength =
      index < lines.length - 1
        ? markdown.slice(offset + line.length, offset + line.length + 2) === '\r\n'
          ? 2
          : 1
        : 0;
    const match = TASK_REFERENCE_PATTERN.exec(line);
    const markerOffset = line.indexOf('[', match?.[1].length ?? 0);
    const metadataOffset = line.indexOf('<!--');
    const metadataEnd = line.indexOf('-->', metadataOffset) + 3;
    const taskPosition = offset + Math.max(markerOffset, metadataOffset);
    if (
      !match ||
      !taskRanges.some(
        (range) =>
          taskPosition >= range.from &&
          taskPosition <= range.to &&
          range.comments.some(
            (comment) =>
              offset + metadataOffset >= comment.from && offset + metadataEnd <= comment.to,
          ),
      )
    ) {
      offset += line.length + lineEndingLength;
      return;
    }

    const [, indent, marker, checked, title, taskId] = match;
    references.push({
      taskId,
      notePath,
      line: index + 1,
      lineStart: offset,
      lineEnd: offset + line.length,
      title: title.trim(),
      completed: checked.toLowerCase() === 'x',
      indent,
      marker: marker as TaskReference['marker'],
    });
    offset += line.length + lineEndingLength;
  });

  return references;
}

/** 从多个本地 Markdown 文件建立任务引用索引。 */
export function buildTaskReferenceIndex(notes: Record<string, string>): TaskReferenceIndex {
  const byTaskId = new Map<string, TaskReference[]>();
  const byNotePath = new Map<string, TaskReference[]>();

  for (const [notePath, markdown] of Object.entries(notes)) {
    const references = parseTaskReferences(markdown, notePath);
    byNotePath.set(notePath, references);

    for (const reference of references) {
      const taskReferences = byTaskId.get(reference.taskId) ?? [];
      taskReferences.push(reference);
      byTaskId.set(reference.taskId, taskReferences);
    }
  }

  return { byTaskId, byNotePath };
}

/** 返回任务在所有本地笔记中的引用。 */
export function referencesForTask(index: TaskReferenceIndex, taskId: string): TaskReference[] {
  return index.byTaskId.get(taskId) ?? [];
}

/** 生成包含稳定任务 ID 的 Markdown 任务引用。 */
export function renderTaskReference(task: Pick<Task, 'id' | 'title' | 'completed'>): string {
  return `- [${task.completed ? 'x' : ' '}] ${task.title} <!-- prism-task:${task.id} -->`;
}

/** 将单个任务引用更新为正式任务的标题和完成状态，并保留缩进及列表符号。 */
export function updateTaskReferenceLine(
  line: string,
  task: Pick<Task, 'id' | 'title' | 'completed'>,
): string {
  const match = TASK_REFERENCE_PATTERN.exec(line);
  if (!match || match[5] !== task.id) return line;

  const [, indent, marker] = match;
  return `${indent}${marker} [${task.completed ? 'x' : ' '}] ${task.title} <!-- prism-task:${task.id} -->`;
}

/** 在 Markdown 中更新指定任务的所有引用，未命中的内容保持不变。 */
export function updateTaskReferences(
  markdown: string,
  task: Pick<Task, 'id' | 'title' | 'completed'>,
): string {
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  const lines = markdown.split(/\r?\n/);
  const references = parseTaskReferences(markdown, '');
  for (const reference of references.filter((item) => item.taskId === task.id).reverse()) {
    lines[reference.line - 1] = updateTaskReferenceLine(lines[reference.line - 1], task);
  }
  return lines.join(newline);
}

/** 从当前笔记移除某个任务引用，但不删除正式任务。 */
export function removeTaskReference(markdown: string, taskId: string, lineNumber?: number): string {
  const lines = markdown.split(/\r?\n/);
  const target = parseTaskReferences(markdown, '').find(
    (reference) => reference.taskId === taskId && (!lineNumber || reference.line === lineNumber),
  );
  if (!target) return markdown;
  const newline = markdown.includes('\r\n') ? '\r\n' : '\n';
  lines.splice(target.line - 1, 1);
  return lines.join(newline);
}
