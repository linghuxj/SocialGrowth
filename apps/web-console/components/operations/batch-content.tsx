'use client';
import React, { useState } from 'react';
import { useOperations } from '@/lib/operations-context';
import { storeAsset } from '@/lib/local-assets';
import { Form, Link, fail } from './shared';
import type { SliceAsset } from '@/lib/first-loop/types';

async function metadata(
  file: File,
): Promise<NonNullable<SliceAsset['mediaMetadata']>> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const video = document.createElement('video');
      const timer = setTimeout(() => {
        video.removeAttribute('src');
        video.load();
        reject(new Error('无法读取视频元数据'));
      }, 15000);
      const cleanup = () => {
        clearTimeout(timer);
        video.onloadedmetadata = null;
        video.onerror = null;
        video.removeAttribute('src');
        video.load();
      };
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        const data = {
          fileName: file.name,
          bytes: file.size,
          duration: video.duration,
          width: video.videoWidth,
          height: video.videoHeight,
        };
        cleanup();
        if (
          !Number.isFinite(data.duration) ||
          data.duration <= 0 ||
          !data.width ||
          !data.height
        )
          reject(new Error('视频元数据无效'));
        else resolve(data);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error('视频格式无法读取'));
      };
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BatchContent() {
  const { state, run, projectId } = useOperations();
  const [progress, setProgress] = useState('');
  return (
    <Form
      id={`content-batch-${projectId}`}
      title="批量导入切片"
      submit="上传并保存本批内容"
      description="每批最多 30 个 MP4，每个文件不超过 100 MB。继承项目默认值，逐行填写故事范围；相同故事的不同语言版本请使用下方单文件登记。导入后仍需准入核对与独占分配。"
      fields={[
        {
          key: 'project',
          label: '运营项目',
          initial: projectId,
          options: state.projects.filter(
            (p) => p.status !== 'exited' && Boolean(p.contentDefaults),
          ),
        },
        { key: 'batch', label: '剧集 / 导入批次' },
        {
          key: 'files',
          label: '切片文件（可多选）',
          type: 'file',
          multiple: true,
        },
        {
          key: 'stories',
          label: '各文件故事范围（按选择顺序，每行一条）',
          type: 'textarea',
          hint: '标题取文件名；故事范围须描述对应剧情，不能只填集数。',
        },
        {
          key: 'confirmed',
          label: '内容身份核对',
          options: [
            {
              id: 'yes',
              name: '已核对每个文件是独立内容，不是同一故事的语言版本',
            },
          ],
        },
      ]}
      onSubmit={async (v, form) => {
        const files = new FormData(form)
          .getAll('files')
          .filter((f): f is File => f instanceof File && f.size > 0);
        const stories = v.stories
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (
          !files.length ||
          files.length > 30 ||
          stories.length !== files.length
        )
          return fail('文件数须为 1–30，故事范围行数须与文件数一致');
        if (
          files.some(
            (f) =>
              !f.name.toLowerCase().endsWith('.mp4') ||
              f.size > 100 * 1024 * 1024,
          )
        )
          return fail('仅接受不超过 100 MB 的 MP4 文件');
        const defaults = state.projects.find(
          (p) => p.id === v.project,
        )?.contentDefaults;
        if (!defaults) return fail('请先在项目中保存素材默认值');
        try {
          const items: {
            title: string;
            storySummary: string;
            asset: Omit<SliceAsset, 'id' | 'contentIdentityId' | 'createdAt'>;
          }[] = [];
          for (const [i, file] of files.entries()) {
            setProgress(`读取与上传 ${i + 1}/${files.length}：${file.name}`);
            const mediaMetadata = await metadata(file);
            const stored = await storeAsset(file);
            items.push({
              title: file.name.replace(/\.mp4$/i, ''),
              storySummary: stories[i],
              asset: {
                ...stored,
                language: defaults.language,
                rightsRef: defaults.rightsRef,
                variant: 'master' as const,
                destinationFit: 'pending_review' as const,
                mediaMetadata,
              },
            });
          }
          const result = await run((e, c) =>
            e.admitContentBatch(
              {
                projectId: v.project,
                batchName: v.batch,
                distinctStoriesConfirmed: v.confirmed === 'yes',
                items,
              },
              c,
            ),
          );
          setProgress(
            result.ok
              ? `已导入 ${items.length} 条内容，等待逐条核对；未自动发布。`
              : '本批业务记录未保存；已上传文件可复用，未生成部分内容记录。',
          );
          return result;
        } catch {
          setProgress('上传中断，尚未提交本批内容记录。');
          return fail('素材读取或上传失败，请检查文件并重试');
        }
      }}
    >
      <Link page="clients" id={projectId}>
        配置项目素材默认值
      </Link>
      {progress && <output className="op-batch-progress">{progress}</output>}
    </Form>
  );
}
